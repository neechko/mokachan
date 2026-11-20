import {
  REL_XP_BASE,
  REL_XP_DAILY_CAP,
  REL_MAX_LEVEL,
  REL_PASSIVE_XP,
  REL_MIN_GAP_SECONDS,
  REL_XP_CURVE,
} from "./config.js";

const STAGES = [
  {
    min: 1,
    max: 2,
    key: "stranger",
    label: "Stranger",
    tone: "polite, warm, not too familiar, avoid being overly casual",
  },
  {
    min: 3,
    max: 4,
    key: "acquaintance",
    label: "Acquaintance",
    tone: "friendly and relaxed, but still keep respectful boundaries",
  },
  {
    min: 5,
    max: 6,
    key: "casual_friend",
    label: "Casual Friend",
    tone: "casual, responsive, start remembering user habits, light jokes are okay",
  },
  {
    min: 7,
    max: 9,
    key: "close_friend",
    label: "Close Friend",
    tone: "more expressive, relaxed, playful, personal but still empathetic",
  },
  {
    min: 10,
    max: 12,
    key: "best_friend",
    label: "Best Friend",
    tone: "very familiar, proactive, understands user style, inside jokes are okay",
  },
  {
    min: 13,
    max: 15,
    key: "confidant",
    label: "Confidant",
    tone: "highly empathetic, careful with feelings, personal and supportive",
  },
  {
    min: 16,
    max: 19,
    key: "deep_bond",
    label: "Deep Bond",
    tone: "very close, strong chemistry, remembers relationship dynamics, natural teasing is okay",
  },
  {
    min: 20,
    max: 999,
    key: "kindred_spirit",
    label: "Kindred Spirit",
    tone: "like a long-time companion, very natural, personal, warm, and emotionally aware",
  },
];

function clampTrait(value) {
  return Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
}

// Raised thresholds so "high" actually means something.
function traitLabel(value) {
  if (value >= 80) return "high";
  if (value >= 45) return "medium";
  return "low";
}

// Traits cannot exceed what the current relationship level allows.
// This prevents a brand-new user from having "high" trust.
export function traitCapForLevel(level) {
  return Math.min(100, 8 + level * 7);
}

// Steeper quadratic curve.
// L2=100, L3=400, L4=900, L5=1600, L7=3600, L10=8100, L20=36100, L30=84100
export function xpForLevel(level) {
  const safeLevel = Math.max(1, level);
  return REL_XP_CURVE * Math.pow(safeLevel - 1, 2);
}

export function levelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  const level = Math.floor(Math.sqrt(safeXp / REL_XP_CURVE)) + 1;
  return Math.max(1, Math.min(REL_MAX_LEVEL, level));
}

export function getRelationshipProfile(state) {
  const xp = Math.max(0, Number(state.relationship_xp) || 0);
  const level = levelFromXp(xp);

  const stage =
    STAGES.find((s) => level >= s.min && level <= s.max) ||
    STAGES[STAGES.length - 1];

  const currentLevelXp = xpForLevel(level);
  const nextLevel = Math.min(REL_MAX_LEVEL, level + 1);
  const nextLevelXp = xpForLevel(nextLevel);

  const isMaxLevel = level >= REL_MAX_LEVEL;
  const neededXp = Math.max(1, nextLevelXp - currentLevelXp);
  const progressXp = Math.max(0, xp - currentLevelXp);

  const progressPercent = isMaxLevel
    ? 100
    : Math.max(0, Math.min(100, (progressXp / neededXp) * 100));

  const cap = traitCapForLevel(level);

  const trust = Math.min(cap, clampTrait(state.trust));
  const comfort = Math.min(cap, clampTrait(state.comfort));
  const familiarity = Math.min(cap, clampTrait(state.familiarity));

  return {
    xp,
    level,
    stageKey: stage.key,
    stageLabel: stage.label,
    tone: stage.tone,

    trust,
    comfort,
    familiarity,
    traitCap: cap,

    trustLabel: traitLabel(trust),
    comfortLabel: traitLabel(comfort),
    familiarityLabel: traitLabel(familiarity),

    currentLevelXp,
    nextLevelXp,
    xpToNext: isMaxLevel ? 0 : Math.max(0, nextLevelXp - xp),
    progressPercent,
    isMaxLevel,
  };
}

export function calculateRelationshipGain(state, prompt, reply, options = {}) {
  const source = options.source || "command";
  const now = new Date();
  const dayDate = now.toISOString().slice(0, 10);

  const dayXpSoFar =
    state.xp_day_date === dayDate ? Number(state.xp_day) || 0 : 0;

  const interactionCount = Number(state.interaction_count) || 0;
  const currentLevel = levelFromXp(state.relationship_xp);
  const cap = traitCapForLevel(currentLevel);

  const currentTrust = clampTrait(state.trust);
  const currentComfort = clampTrait(state.comfort);
  const currentFamiliarity = clampTrait(state.familiarity);

  let xp = 0;
  let trustDelta = 0;
  let comfortDelta = 0;
  let familiarityDelta = 0;
  let blockedReason = null;

  const lastAt = state.last_interaction_at
    ? new Date(state.last_interaction_at).getTime()
    : 0;

  const secondsSinceLast = lastAt ? (now.getTime() - lastAt) / 1000 : Infinity;

  // Anti-spam gate: messages sent too quickly earn nothing.
  if (secondsSinceLast < REL_MIN_GAP_SECONDS) {
    blockedReason = "cooldown";
  }

  if (source === "passive") {
    if (!blockedReason) {
      xp = REL_PASSIVE_XP;
      // Familiarity grows slowly from background chat, every 6th batch.
      if (interactionCount % 6 === 0) familiarityDelta = 1;
    }
  } else if (!blockedReason) {
    const text = String(prompt || "").trim();
    const lower = text.toLowerCase();

    const lastPrompt = String(state.last_prompt || "").trim().toLowerCase();

    const repeatedRecently =
      lastPrompt &&
      lower === lastPrompt &&
      now.getTime() - lastAt < 30 * 60 * 1000;

    const tooShort = text.length < 12;
    const spammy = /^(.)\1{4,}$/.test(text.replace(/\s/g, ""));

    if (repeatedRecently) blockedReason = "repeated";
    else if (tooShort) blockedReason = "too_short";
    else if (spammy) blockedReason = "spam";

    if (!blockedReason) {
      xp = REL_XP_BASE;

      if (text.length > 80) xp += 2;
      if (text.length > 200) xp += 2;

      if (/\?|why|how|what|who|when|where|which|kenapa|bagaimana|apa|siapa|kapan/i.test(lower)) {
        xp += 1;
      }

      const emotional =
        /\b(i feel|my heart|sad|happy|tired|scared|angry|disappointed|proud|lonely|miss|sedih|senang|capek|takut|marah|kecewa|bangga|kesepian)\b/i.test(
          lower
        );

      if (emotional) {
        xp += 2;
        // Trust is slow: +1 only every 3rd meaningful interaction.
        if (interactionCount % 3 === 0) trustDelta = 1;
      }

      const playful = /wkwk|haha|hehe|lol|😂|🤣|😭|💀|✨/i.test(text);
      if (playful && interactionCount % 2 === 0) {
        comfortDelta = 1;
      }

      if (/\b(thanks|thank you|thx|ty|appreciate it|makasih|terima kasih)\b/i.test(lower)) {
        trustDelta = Math.max(trustDelta, 1);
      }

      // Familiarity: +1 only every 4th meaningful interaction.
      if (interactionCount % 4 === 0) familiarityDelta = 1;
    }
  }

  // Daily diminishing returns: the more you farm today, the less each message gives.
  if (xp > 0) {
    if (dayXpSoFar >= 45) xp = Math.floor(xp * 0.25);
    else if (dayXpSoFar >= 30) xp = Math.floor(xp * 0.5);
  }

  const remainingCap = Math.max(0, REL_XP_DAILY_CAP - dayXpSoFar);
  xp = Math.max(0, Math.min(xp, remainingCap));

  if (xp === 0) {
    trustDelta = 0;
    comfortDelta = 0;
    familiarityDelta = 0;
  }

  // Hard-cap traits by level so they can never run ahead of the relationship.
  trustDelta = Math.max(0, Math.min(trustDelta, cap - currentTrust));
  comfortDelta = Math.max(0, Math.min(comfortDelta, cap - currentComfort));
  familiarityDelta = Math.max(
    0,
    Math.min(familiarityDelta, cap - currentFamiliarity)
  );

  return {
    xp,
    trustDelta,
    comfortDelta,
    familiarityDelta,
    dayXp: dayXpSoFar + xp,
    dayDate,
    now,
    blockedReason,
  };
}

export function formatRelationshipForPrompt(profile) {
  return [
    `Closeness level: ${profile.level} — ${profile.stageLabel}`,
    `Trust: ${profile.trustLabel}; Comfort: ${profile.comfortLabel}; Familiarity: ${profile.familiarityLabel}`,
    `Recommended speaking style: ${profile.tone}.`,
    `Do not explicitly mention level/XP numbers unless the user asks or uses the profile command.`,
    `Closeness grows slowly over many conversations. Do not act overly intimate beyond the current stage.`,
  ].join("\n");
}

function progressBar(percent, width = 12) {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round((safe / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

// Single consolidated block: XP, progress, and traits shown ONCE.
export function formatRelationshipForDisplay(profile) {
  const lines = [];

  lines.push(`**Level ${profile.level} — ${profile.stageLabel}**`);

  if (profile.isMaxLevel) {
    lines.push(`XP: **${profile.xp}** (max level)`);
  } else {
    lines.push(
      `XP: **${profile.xp} / ${profile.nextLevelXp}** (${profile.progressPercent.toFixed(1)}%)`
    );
    lines.push(
      `${progressBar(profile.progressPercent)} ${profile.progressPercent.toFixed(1)}%`
    );
    lines.push(`**${profile.xpToNext} XP** to next level`);
  }

  lines.push("");
  lines.push(`Trust: **${profile.trustLabel}** · ${profile.trust}/${profile.traitCap}`);
  lines.push(`Comfort: **${profile.comfortLabel}** · ${profile.comfort}/${profile.traitCap}`);
  lines.push(`Familiarity: **${profile.familiarityLabel}** · ${profile.familiarity}/${profile.traitCap}`);
  lines.push("");
  lines.push(`-# Trait ceiling at this level: ${profile.traitCap}/100. Daily XP cap: ${REL_XP_DAILY_CAP}.`);

  return lines.join("\n");
}