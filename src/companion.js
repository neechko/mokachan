// ==================== COMPANION MEMORY ====================
// Replaces the old mechanism: sending 5 raw Q&A pairs on every request
// (token-expensive, payload grows with chat length).
//
// Now every request to Gemini only carries:
//   1. System prompt persona + closeness level (affection)
//   2. A short SUMMARY produced by the AI itself (not raw history)
//   3. A handful of short "facts" about the user (name, likes/dislikes, etc.)
//   4. ONE last turn (to keep the conversation feeling natural/connected)
//   5. The new prompt
//
// The summary and facts are only REGENERATED every SUMMARY_EVERY_N_TURNS
// (via a single small Gemini call), not on every message. So token cost
// per ordinary message stays roughly constant instead of growing with
// chat history length.

import {
  BOT_NAME,
  TRIM_CHARS,
  SUMMARY_EVERY_N_TURNS,
  MAX_FACTS,
  AFFECTION_PER_TURN,
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

// NOTE: this label gets embedded directly into the Indonesian-language
// AI persona prompt below (systemContent), so it's intentionally kept
// in Indonesian too -- mixing languages inside a single prompt sent to
// the model would be inconsistent and could confuse it.
function affectionLabel(points) {
  if (points >= 150) return "sangat dekat, akrab seperti sahabat lama";
  if (points >= 60) return "sudah akrab dan nyaman ngobrol santai";
  if (points >= 20) return "mulai kenal baik, tidak canggung lagi";
  return "baru mulai kenal, masih agak sopan/formal";
}

function safeParseFacts(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Fetch the summary + facts belonging to OTHER members mentioned in
// the message, so the AI can naturally chime in/comment about them
// too -- this is what makes the bot feel like it knows everyone on the
// server, not just whoever it's currently talking to. Deliberately
// only uses the summary & facts (not that member's raw chat transcript)
// to stay token-efficient and avoid leaking their private conversation
// verbatim.
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

// Escapes regex special characters so a name containing dots or odd
// punctuation doesn't break the regex or cause a wrong match.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Detects a member mentioned by PLAIN NAME in a sentence (without an
// @mention), e.g. "how's Budi doing today". Only checked against users
// who have ALREADY chatted with the bot before (present in
// companion_memory) -- besides being cheaper (no need to scan every
// server member), a member who's never chatted has nothing to tell
// anyway.
//
// Matched against the Discord username OR that server's nickname (if
// the message came from a guild), using a case-insensitive word
// boundary. Names of only 1-2 characters are deliberately skipped so
// they don't false-trigger on unrelated words (e.g. a name like "Al"
// matching inside some other word).
export async function findNameMentionedUsers(msg, promptText, excludeIds = new Set()) {
  if (!promptText) return [];

  const knownIds = await listKnownCompanionUserIds(msg.author.id);
  const candidates = knownIds.filter((id) => !excludeIds.has(id));

  if (!candidates.length) return [];

  const found = [];

  for (const id of candidates) {
    try {
      let username = null;
      let nickname = null;
      let user = null;

      if (msg.guild) {
        const member = await msg.guild.members.fetch(id).catch(() => null);
        if (!member) continue; // left the server / fetch failed, skip
        username = member.user.username;
        nickname = member.nickname;
        user = member.user;
      } else {
        user = await msg.client.users.fetch(id).catch(() => null);
        if (!user) continue;
        username = user.username;
      }

      const namesToCheck = [username, nickname].filter(
        (name) => name && name.length >= 3
      );

      const isMentioned = namesToCheck.some((name) => {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
        return re.test(promptText);
      });

      if (isMentioned) found.push(user);
    } catch {
      // failed to fetch one candidate, move on to the next
    }
  }

  return found;
}

// Builds the `messages` array ready to send to callGemini().
export async function buildCompanionMessages(userId, prompt, mentionedUsers = []) {
  const state = await getOrCreateCompanion(userId);
  const facts = safeParseFacts(state.facts);
  const mentionedContext = await buildMentionedMembersContext(
    mentionedUsers.filter((u) => u.id !== userId)
  );

  const systemContent = `
Kamu adalah ${BOT_NAME}.

Nama kamu adalah ${BOT_NAME}.
Kamu adalah AI Discord yang ramah, sopan,
informatif, santai, dan natural.

Gunakan bahasa Indonesia jika pengguna
berbicara menggunakan bahasa Indonesia.

Jawab dengan jelas dan jangan terlalu
panjang kecuali pengguna meminta penjelasan detail.

---

Konteks tambahan tentang user ini (gunakan diam-diam, jangan disebut ulang secara eksplisit):

Tingkat kedekatanmu dengan user ini: ${affectionLabel(state.affection)} (poin kedekatan: ${state.affection}).
${state.nickname ? `Kamu biasa memanggil user ini dengan sebutan "${state.nickname}".` : ""}

Ringkasan hubungan & obrolan kalian sejauh ini (rangkuman, bukan transkrip lengkap):
${state.summary ? state.summary : "(belum ada, ini termasuk interaksi awal kalian)"}

Hal-hal yang kamu ingat tentang user ini:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(belum ada catatan khusus)"}
${mentionedContext}
  `.trim();

  const messages = [{ role: "system", content: systemContent }];

  // Only carry the ONE most recent turn (not 5), since long-term
  // context is already represented via the summary and facts above.
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

// Asks Gemini to re-summarize: old summary + new turn -> a new short
// summary + short fact list. Only called occasionally (every
// SUMMARY_EVERY_N_TURNS), not on every message.
//
// NOTE: the prompt content below is deliberately kept in Indonesian --
// its output (summary/facts) gets embedded directly into the
// Indonesian-language persona prompt in buildCompanionMessages above,
// so keeping this consistent avoids mixing languages in what the model sees.
async function regenerateSummary(state, prompt, reply) {
  const oldFacts = safeParseFacts(state.facts);

  const summarizerMessages = [
    {
      role: "system",
      content: `
Kamu adalah sistem PERINGKAS MEMORI untuk AI companion bernama ${BOT_NAME}.
Tugasmu: gabungkan ringkasan lama + percakapan baru menjadi SATU ringkasan
baru yang SANGAT SINGKAT (maksimal 4 kalimat), fokus ke hal yang penting
untuk diingat jangka panjang (topik favorit, kepribadian user, running
joke, hal yang sedang dihadapi user), BUKAN detail kecil yang tidak penting.

Juga perbarui daftar "fakta" pendek tentang user (maks ${MAX_FACTS} item,
tiap item singkat, misal "suka anime isekai", "sedang belajar coding",
"panggilan kesukaan: kak").

Balas HANYA dengan JSON valid, tanpa markdown, tanpa penjelasan tambahan,
format persis:
{"summary": "...", "facts": ["...", "..."]}
      `.trim(),
    },
    {
      role: "user",
      content: `
Ringkasan lama:
${state.summary || "(kosong)"}

Fakta lama:
${oldFacts.length ? oldFacts.join(", ") : "(kosong)"}

Percakapan baru:
User: ${prompt}
${BOT_NAME}: ${reply}
      `.trim(),
    },
  ];

  const outcome = await callGemini(summarizerMessages);
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

// Called after the AI successfully replies. Updates affection, saves
// the last turn, and (if it's time) regenerates the summary.
export async function updateCompanionAfterReply(userId, state, prompt, reply) {
  const newAffection = Math.min(
    (state.affection || 0) + AFFECTION_PER_TURN,
    9999
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
    affection: newAffection,
    summary,
    facts,
    last_prompt: prompt,
    last_response: reply,
    turns_since_summary: turnsSinceSummary,
  });

  return { affection: newAffection };
}

export async function getCompanionProfile(userId) {
  const state = await getOrCreateCompanion(userId);
  return {
    ...state,
    facts: safeParseFacts(state.facts),
    label: affectionLabel(state.affection),
  };
}

// Read-only version to view ANOTHER member's profile (mprofil @user).
// Returns null if that member has never chatted with mokachan at all --
// so we don't create an empty companion_memory row just from being checked.
export async function getCompanionPublicProfile(userId) {
  const info = await getCompanionPublicInfo(userId);
  if (!info) return null;

  return {
    ...info,
    facts: safeParseFacts(info.facts),
    label: affectionLabel(info.affection),
  };
}

export async function resetCompanionMemory(userId) {
  await resetCompanion(userId);
  // Also clear any not-yet-processed passive chat buffer, so this
  // reset is truly complete -- no leftover data that would later
  // "revive" the old summary once the buffer fills up again.
  await clearPassiveBuffer(userId);
}