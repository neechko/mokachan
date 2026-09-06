import dotenv from "dotenv";

dotenv.config();

// ==================== CORE ====================

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const NOTIFY_CHANNEL_ID = process.env.CHANNEL_ID;

export const BOT_NAME = process.env.BOT_NAME || "mokachan";
export const PREFIX = process.env.COMMAND_PREFIX || "m";
export const COMMAND_CASE_INSENSITIVE =
  process.env.COMMAND_CASE_INSENSITIVE === "true";

// Discord user ID of the bot owner. Used to gate owner-only commands
// (e.g. directly granting yourself a character card) -- unlike server
// "Manage Server" permission checks used elsewhere, this is tied to
// one specific person regardless of which server the command is run
// in. Find your own ID: enable Developer Mode in Discord settings,
// then right-click your profile and choose "Copy User ID".
export const OWNER_ID = process.env.OWNER_ID || null;

// ==================== HISTORY / OUTPUT ====================

export const HISTORY_COUNT = parseInt(process.env.HISTORY_COUNT, 10) || 5;

// How many raw history rows (mhistory) are kept PER USER before being
// auto-deleted. This history is only for manual review -- NOT the AI
// context source anymore (that's companion_memory's job) -- so it's
// safe to keep bounded. This is what prevents the `history` table from
// growing forever and choking hosting disk space.
export const HISTORY_RETAIN_COUNT =
  parseInt(process.env.HISTORY_RETAIN_COUNT, 10) || 30;

export const TRIM_CHARS = parseInt(process.env.TRIM_CHARS, 10) || 700;
export const MAX_OUTPUT_CHARS =
  parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 1800;

// ==================== GEMINI ====================

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Comma-separated model list, tried IN ORDER left to right. If the
// first model is rate-limited/fails, automatically moves on to the
// next. Example .env: GEMINI_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite
// GEMINI_MODEL (singular, legacy name) is still supported for compatibility.
export const GEMINI_MODELS = (
  process.env.GEMINI_MODELS ||
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash,gemini-3.5-flash-lite"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

// Retry PER MODEL, only for transient errors (network error / 5xx).
// 429 is never retried on the same model (see gemini.js).
export const GEMINI_MAX_RETRIES =
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 3;

export const GEMINI_RETRY_DELAY =
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) || 2000;

// HARD cap on the number of Gemini requests actually sent for ONE
// callGemini() call, counted across ALL models + retries combined.
// This is the main safety brake: no matter how many GEMINI_MODELS are
// configured (e.g. 10), total API requests per user message stay
// capped at this number.
export const GEMINI_MAX_TOTAL_ATTEMPTS =
  parseInt(process.env.GEMINI_MAX_TOTAL_ATTEMPTS, 10) || 6;

// After a model gets a 429, it is "rested" for this many ms and won't
// be tried again (even from a different user's message) until the
// cooldown expires. Prevents the bot from continuously hammering a
// model that's already clearly rate-limited.
export const GEMINI_MODEL_COOLDOWN_MS =
  parseInt(process.env.GEMINI_MODEL_COOLDOWN_MS, 10) || 60000;

// ==================== COMPANION MEMORY (rolling summary) ====================
// Replaces the old "resend N raw history messages on every request"
// approach. Now it only sends: system persona + short summary + key
// facts + ONE last turn (for conversational flow) + the new prompt.
// The summary is updated by the AI itself every SUMMARY_EVERY_N_TURNS
// turns, so token cost stays roughly constant even after hundreds of messages.

export const SUMMARY_EVERY_N_TURNS =
  parseInt(process.env.SUMMARY_EVERY_N_TURNS, 10) || 6;

export const MAX_FACTS = parseInt(process.env.MAX_FACTS, 10) || 8;

export const AFFECTION_PER_TURN =
  parseInt(process.env.AFFECTION_PER_TURN, 10) || 1;

// ==================== PASSIVE LEARNING (the bot gets to know each member) ====================
// The bot quietly "listens" to ordinary chat (NOT commands) across
// every channel it can access, and once PASSIVE_LEARN_BATCH_SIZE
// messages have accumulated from one user, summarizes them once into
// an update to the summary/facts in the SAME companion_memory used by
// the `mokachan` command -- so the profile stays unified. This never
// triggers a reply, it just learns quietly in the background.
export const PASSIVE_LEARN_BATCH_SIZE =
  parseInt(process.env.PASSIVE_LEARN_BATCH_SIZE, 10) || 12;

export const PASSIVE_LEARN_MIN_LENGTH =
  parseInt(process.env.PASSIVE_LEARN_MIN_LENGTH, 10) || 4;

// ==================== ANIME CHARACTER CLAIM (Rimi-chan-style spawn) ====================
// While a server has chat activity, a random character from AniList
// automatically appears every CHARACTER_SPAWN_INTERVAL_MS (default 20
// minutes), and WHOEVER types the claim command first gets it. If
// nobody claims it within CHARACTER_SPAWN_TIMEOUT_MS, the spawn
// expires and a new one can appear after the next interval.

export const CHARACTER_SPAWN_INTERVAL_MS =
  parseInt(process.env.CHARACTER_SPAWN_INTERVAL_MS, 10) || 20 * 60 * 1000;

export const CHARACTER_SPAWN_TIMEOUT_MS =
  parseInt(process.env.CHARACTER_SPAWN_TIMEOUT_MS, 10) || 10 * 60 * 1000;

// Default channel where characters appear (optional, can be set in
// .env). If empty, an admin MUST set it via `msetspawnchannel` first
// before automatic spawning activates -- so it doesn't spread to every channel.
export const DEFAULT_SPAWN_CHANNEL_ID =
  process.env.CHARACTER_SPAWN_CHANNEL_ID || null;

// ==================== COMMANDS ====================

export const COMMANDS = {
  ai: process.env.CMD_MOKACHAN || "mokachan",
  lyrics: process.env.CMD_LYRICS || "lyrics",
  history: process.env.CMD_HISTORY || "history",
  clearHistory: process.env.CMD_CLEARHISTORY || "clearhistory",
  stats: process.env.CMD_STATS || "stats",
  ping: process.env.CMD_PING || "ping",
  help: process.env.CMD_HELP || "help",
  claim: process.env.CMD_CLAIM || "claim",
  koleksi: process.env.CMD_KOLEKSI || "koleksi",
  profil: process.env.CMD_PROFIL || "profil",
  resetcompanion: process.env.CMD_RESETCOMPANION || "resetcompanion",
  diskusage: process.env.CMD_DISKUSAGE || "diskusage",
  vacuumconvert: process.env.CMD_VACUUMCONVERT || "vacuumconvert",
  setSpawnChannel: process.env.CMD_SETSPAWNCHANNEL || "setspawnchannel",
  admincard: process.env.CMD_ADMINCARD || "admincard",
};

// ==================== VALIDATION ====================

export function validateConfig() {
  if (!DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is not set.");
    process.exit(1);
  }

  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set.");
    process.exit(1);
  }
}