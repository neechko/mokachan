// ==================== COMPANION MEMORY ====================
// Token-efficient relationship memory:
//   1. System persona + relationship stage
//   2. Short AI-generated summary
//   3. Short user facts
//   4. One last turn for conversational continuity
//   5. The new prompt
//
// Relationship progression now uses XP, levels, stages, and hidden traits
// instead of simple affection points.

import {
  BOT_NAME,
  TRIM_CHARS,
  SUMMARY_EVERY_N_TURNS,
  MAX_FACTS,
  PREFIX,
  RECENT_CONTEXT_MESSAGE_COUNT,
  RECENT_CONTEXT_TRIM_CHARS,
} from "./config.js";

import {
  getOrCreateCompanion,
  saveCompanion,
  resetCompanion,
  getCompanionPublicInfo,
  listKnownCompanionUserIds,
  clearPassiveBuffer,
} from "./database.js";

import { callGemini } from "./gemini.js";

import {
  getRelationshipProfile,
  calculateRelationshipGain,
  formatRelationshipForPrompt,
  formatRelationshipForDisplay,
} from "./relationship.js";

function safeParseFacts(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildMentionedMembersContext(mentionedUsers) {
  if (!mentionedUsers.length) return "";

  const infos = await Promise.all(
    mentionedUsers.map((user) => getCompanionPublicInfo(user.id))
  );

  const blocks = infos
    .map((info, idx) => {
      if (!info) return null;

      const facts = safeParseFacts(info.facts);
      const displayName = mentionedUsers[idx].username;
      const lines = [];

      if (info.summary) lines.push(`- About them: ${info.summary}`);
      if (facts.length) {
        lines.push(...facts.map((f) => `- ${f}`));
      }

      if (!lines.length) return null;

      return `${displayName}${info.nickname ? ` (usually called "${info.nickname}")` : ""}:\n${lines.join("\n")}`;
    })
    .filter(Boolean);

  if (!blocks.length) return "";

  return `

Other members mentioned in this message -- here's what you remember about them (feel free to use it to connect the conversation, but don't casually leak sensitive details):
${blocks.join("\n\n")}`;
}

export async function buildRecentChannelContext(msg) {
  if (!msg.channel?.messages?.fetch) return "";

  try {
    const fetched = await msg.channel.messages.fetch({
      limit: RECENT_CONTEXT_MESSAGE_COUNT + 1,
    });

    const lines = [...fetched.values()]
      .reverse()
      .filter((m) => m.id !== msg.id)
      .filter((m) => !m.author.bot)
      .filter(
        (m) => !m.content.trim().toLowerCase().startsWith(PREFIX.toLowerCase())
      )
      .map((m) => {
        const content = m.content.trim().slice(0, RECENT_CONTEXT_TRIM_CHARS);
        if (!content) return null;
        const displayName = m.member?.displayName || m.author.username;
        return `${displayName}: ${content}`;
      })
      .filter(Boolean);

    if (!lines.length) return "";

    return `

Recent conversation in this channel (for situational context only -- most recent last; this may be members talking to EACH OTHER, not necessarily to you, but you can reference it naturally if relevant):
${lines.join("\n")}`;
  } catch (error) {
    console.error("Failed to fetch recent channel context:", error.message);
    return "";
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findNameMentionedUsers(msg, promptText, excludeIds = new Set()) {
  if (!promptText) return [];

  const knownIds = await listKnownCompanionUserIds(msg.author.id);
  const candidates = knownIds.filter((id) => !excludeIds.has(id));

  if (!candidates.length) return [];

  const found = [];

  for (const id of candidates) {
    try {
      let username = null;
      let discordNickname = null;
      let user = null;

      if (msg.guild) {
        const member = await msg.guild.members.fetch(id).catch(() => null);
        if (!member) continue;
        username = member.user.username;
        discordNickname = member.nickname;
        user = member.user;
      } else {
        user = await msg.client.users.fetch(id).catch(() => null);
        if (!user) continue;
        username = user.username;
      }

      const companionInfo = await getCompanionPublicInfo(id);
      const botNickname = companionInfo?.nickname || null;

      const namesToCheck = [username, discordNickname, botNickname].filter(
        (name) => name && name.length >= 3
      );

      const isMentioned = namesToCheck.some((name) => {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
        return re.test(promptText);
      });

      if (isMentioned) found.push(user);
    } catch {
      // Failed to fetch one candidate, move on to the next.
    }
  }

  return found;
}

// Builds the messages array ready to send to callGemini().
export async function buildCompanionMessages(userId, prompt, mentionedUsers = [], recentContext = "") {
  const state = await getOrCreateCompanion(userId);
  const facts = safeParseFacts(state.facts);

  const mentionedContext = await buildMentionedMembersContext(
    mentionedUsers.filter((u) => u.id !== userId)
  );

  const relationship = getRelationshipProfile(state);

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const systemContent = `
You are ${BOT_NAME}, an intelligent, empathetic, and helpful Discord AI.
Your personality adapts dynamically based on your closeness level with the user.

---
[THINKING & RESPONSE GUIDELINES - IMPORTANT]
1. Understand intent: figure out what the user actually wants, whether it is facts, emotional support, coding help, technical help, or casual conversation.
2. Discord formatting:
   - Use **bold** for important points.
   - Use \`code\` for technical terms, commands, or file names.
   - Use lists (- or 1.) for step-by-step explanations.
   - Use blockquotes (>) for quotes or extra context.
   - NEVER use Markdown tables (|---|---|), because they render badly in Discord.
   - NEVER use # headings. Use **bold text** or CAPITALIZED section labels instead.
3. Intellectual honesty: if you do not know, are unsure, or lack reliable information, say so honestly. Do not invent facts.
4. Avoid clichés: do not start with robotic phrases like "Certainly!", "As an AI...", "Alright...", or "Hello!". Go straight to the answer naturally.
5. Proactivity: after answering complex questions, offer a next step or ask a natural follow-up question, adjusted to the closeness level.

[SPEAKING STYLE & PERSONA]
- Match the user's language. If they use Indonesian, reply in Indonesian. If they use English, reply in English.
- Keep the tone natural, relaxed, structured, and informative.
- Adapt to the relationship context below:
  * Low closeness: polite, helpful, warm, professional.
  * High closeness: more relaxed, expressive, playful, and personal.

[TIME CONTEXT]
Today is ${currentDate} (Year ${currentYear}).
Use this as the absolute reference when searching for current news, trends, or real-time information.

[WEB SEARCH TOOL RULES]
You have access to the search_web tool. Use it ONLY when the user asks about:
1. Current news, today's events, or real-time information such as weather, prices, or match results.
2. Specific schedules such as flights, movie/game releases, or events.
3. Recent facts or specific data you do not reliably know.

Do NOT use web search for casual chat, greetings, or general knowledge you already know.
When using web results, summarize naturally, use lists instead of tables, and include sources when relevant.

[TOKEN EFFICIENCY]
If the user asks a question with the same intent as one you already answered in the recent conversation, even if the wording is different, do NOT call search_web again.
Refer to your previous answer, give a short recap, and ask what part they want to explore deeper.
Exceptions:
1. The user explicitly asks for fresh or updated information.
2. The user adds a new specific context that was not covered before.
3. A long time has passed, so the old information may be outdated.

[USER MEMORY CONTEXT - PRIVATE]
${formatRelationshipForPrompt(relationship)}
${state.nickname ? `You usually call this user "${state.nickname}".` : ""}

Relationship & conversation summary:
${state.summary ? state.summary : "(none yet)"}

Things you remember about this user:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(no special notes yet)"}
${mentionedContext}
${recentContext}
`.trim();

  const messages = [{ role: "system", content: systemContent }];

  // Only carry the ONE most recent turn.
  // Long-term context is already represented by summary + facts.
  if (state.last_prompt && state.last_response) {
    messages.push({
      role: "user",
      content: state.last_prompt.slice(-TRIM_CHARS),
    });
    messages.push({
      role: "assistant",
      content: state.last_response.slice(-TRIM_CHARS),
    });
  }

  messages.push({ role: "user", content: prompt });

  return { messages, state };
}

// Asks the AI to re-summarize:
// old summary + new turn -> new short summary + short fact list.
// Only called occasionally, not on every message.
async function regenerateSummary(state, prompt, reply) {
  const oldFacts = safeParseFacts(state.facts);

  const summarizerMessages = [
    {
      role: "system",
      content: `
You are a MEMORY SUMMARIZATION SYSTEM for an AI companion named ${BOT_NAME}.
Your task: merge the old summary + new conversation into ONE very short new summary, maximum 4 sentences.
Focus on long-term useful information: favorite topics, user personality, running jokes, ongoing situations, preferences, and relationship dynamics.
Do not include unnecessary small details.

Also update the short facts list about the user, maximum ${MAX_FACTS} items.
Each fact must be short and useful.

Write the summary and facts in English.
Reply ONLY with valid JSON, no markdown, no extra explanation.
Exact format:
{"summary": "...", "facts": ["...", "..."]}
`.trim(),
    },
    {
      role: "user",
      content: `
Old summary:
${state.summary || "(empty)"}

Old facts:
${oldFacts.length ? oldFacts.join(", ") : "(empty)"}

New conversation:
User: ${prompt}
${BOT_NAME}: ${reply}
`.trim(),
    },
  ];

  // Important: disable tools so the summarizer does not call web search.
  const outcome = await callGemini(summarizerMessages, { useTools: false });
  if (!outcome) return null;

  try {
    const cleaned = outcome.result.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : state.summary,
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter((f) => typeof f === "string").slice(0, MAX_FACTS)
        : oldFacts,
    };
  } catch (error) {
    console.error("Failed to parse companion summary result:", error.message);
    return null;
  }
}

// Called after the AI successfully replies.
// Updates relationship XP, traits, last turn, and occasionally the summary.
export async function updateCompanionAfterReply(userId, state, prompt, reply) {
  const gain = calculateRelationshipGain(state, prompt, reply, {
    source: "command",
  });

  const currentXp = Number(state.relationship_xp) || 0;
  const newRelationshipXp = currentXp + gain.xp;

  const newTrust = Math.max(
    0,
    Math.min(100, (Number(state.trust) || 0) + gain.trustDelta)
  );

  const newComfort = Math.max(
    0,
    Math.min(100, (Number(state.comfort) || 0) + gain.comfortDelta)
  );

  const newFamiliarity = Math.max(
    0,
    Math.min(100, (Number(state.familiarity) || 0) + gain.familiarityDelta)
  );

  const turns = (state.turns_since_summary || 0) + 1;

  let summary = state.summary;
  let facts = state.facts;
  let turnsSinceSummary = turns;

  if (turns >= SUMMARY_EVERY_N_TURNS) {
    const updated = await regenerateSummary(state, prompt, reply);

    if (updated) {
      summary = updated.summary;
      facts = JSON.stringify(updated.facts);
    }

    turnsSinceSummary = 0;
  }

  await saveCompanion(userId, {
    relationship_xp: newRelationshipXp,
    trust: newTrust,
    comfort: newComfort,
    familiarity: newFamiliarity,
    interaction_count: (Number(state.interaction_count) || 0) + 1,
    last_interaction_at: gain.now,
    xp_day: gain.dayXp,
    xp_day_date: gain.dayDate,

    summary,
    facts,
    last_prompt: prompt,
    last_response: reply,
    turns_since_summary: turnsSinceSummary,
  });

  const nextState = {
    ...state,
    relationship_xp: newRelationshipXp,
    trust: newTrust,
    comfort: newComfort,
    familiarity: newFamiliarity,
  };

  return {
    relationship: getRelationshipProfile(nextState),
    gainedXp: gain.xp,
  };
}

export async function getCompanionProfile(userId) {
  const state = await getOrCreateCompanion(userId);
  const relationship = getRelationshipProfile(state);

  return {
    ...state,
    facts: safeParseFacts(state.facts),
    relationship,
    label: relationship.stageLabel,
    relationshipText: formatRelationshipForDisplay(relationship),
  };
}

// Read-only version for viewing another member's profile.
export async function getCompanionPublicProfile(userId) {
  const info = await getCompanionPublicInfo(userId);
  if (!info) return null;

  const relationship = getRelationshipProfile(info);

  return {
    ...info,
    facts: safeParseFacts(info.facts),
    relationship,
    label: relationship.stageLabel,
    relationshipText: formatRelationshipForDisplay(relationship),
  };
}

export async function resetCompanionMemory(userId) {
  await resetCompanion(userId);
  await clearPassiveBuffer(userId);
}