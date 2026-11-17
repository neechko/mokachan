import dotenv from "dotenv";

dotenv.config();

// ==================== CORE ====================

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const NOTIFY_CHANNEL_ID = process.env.CHANNEL_ID;

// ==================== DEBUGGING ====================
export const DEBUG_MODE = process.env.DEBUG_MODE === "true";

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

// ==================== AI PROVIDER (universal, OpenAI-compatible) ====================
//
// Semua provider di bawah ini kompatibel dengan format "OpenAI Chat
// Completions" -- cukup ubah 3 baris .env (AI_ENDPOINT, AI_API_KEY,
// AI_MODELS) tanpa menyentuh file .js sama sekali:
//
//   NVIDIA Nemotron:
//     AI_ENDPOINT=https://integrate.api.nvidia.com/v1/chat/completions
//     AI_API_KEY=nvapi-xxxx
//     AI_MODELS=nvidia/nemotron-3-super-120b-a12b,nvidia/nemotron-3-nano-30b-a3b
//
//   OpenAI:
//     AI_ENDPOINT=https://api.openai.com/v1/chat/completions
//     AI_API_KEY=sk-xxxx
//     AI_MODELS=gpt-4o,gpt-4o-mini
//
//   Groq:
//     AI_ENDPOINT=https://api.groq.com/openai/v1/chat/completions
//     AI_API_KEY=gsk_xxxx
//     AI_MODELS=llama-3.3-70b-versatile,llama-3.1-8b-instant
//
//   DeepSeek:
//     AI_ENDPOINT=https://api.deepseek.com/v1/chat/completions
//     AI_API_KEY=sk-xxxx
//     AI_MODELS=deepseek-chat,deepseek-reasoner
//
//   OpenRouter:
//     AI_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
//     AI_API_KEY=sk-or-v1-xxxx
//     AI_MODELS=anthropic/claude-3.5-sonnet,google/gemini-2.5-flash
//
//   Gemini (lewat endpoint OpenAI-compat):
//     AI_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
//     AI_API_KEY=AIzaSy...
//     AI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite

// Endpoint -- kalau kosong, fallback ke NVIDIA agar bot tetap nyala.
export const AI_ENDPOINT =
  process.env.AI_ENDPOINT ||
  "https://integrate.api.nvidia.com/v1/chat/completions";

// API key. Prioritas: AI_API_KEY → GEMINI_API_KEY (kompatibel .env lama).
export const AI_API_KEY =
  process.env.AI_API_KEY || process.env.GEMINI_API_KEY;

// Daftar model, dipisah koma, dicoba dari kiri ke kanan.
// Prioritas: AI_MODELS → GEMINI_MODELS → GEMINI_MODEL (legacy).
export const AI_MODELS = (
  process.env.AI_MODELS ||
  process.env.GEMINI_MODELS ||
  process.env.GEMINI_MODEL ||
  "nvidia/nemotron-3-super-120b-a12b,nvidia/nemotron-3-nano-30b-a3b"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Retry PER MODEL, hanya untuk error transient (network / 5xx).
// 429 tidak di-retry di model yang sama (langsung fallback).
export const AI_MAX_RETRIES =
  parseInt(process.env.AI_MAX_RETRIES, 10) ||
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) ||
  3;

export const AI_RETRY_DELAY =
  parseInt(process.env.AI_RETRY_DELAY, 10) ||
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) ||
  2000;

// Batas keras jumlah request aktual untuk SATU callGemini(),
// dihitung di semua model + retry. Ini rem utama: berapa pun
// panjang AI_MODELS, total request per pesan user dibatasi ini.
export const AI_MAX_TOTAL_ATTEMPTS =
  parseInt(process.env.AI_MAX_TOTAL_ATTEMPTS, 10) ||
  parseInt(process.env.GEMINI_MAX_TOTAL_ATTEMPTS, 10) ||
  6;

// Setelah 429, model "diistirahatkan" selama ini (ms) dan tidak
// dipakai lagi (bahkan dari user lain) sampai cooldown habis.
export const AI_MODEL_COOLDOWN_MS =
  parseInt(process.env.AI_MODEL_COOLDOWN_MS, 10) ||
  parseInt(process.env.GEMINI_MODEL_COOLDOWN_MS, 10) ||
  60000;

// ---- Alias kompatibilitas: agar gemini.js & file lama tetap jalan ----
// Semua nama GEMINI_* sekarang menunjuk ke nilai AI_* di atas.
export const GEMINI_API_KEY            = AI_API_KEY;
export const GEMINI_MODELS             = AI_MODELS;
export const GEMINI_MAX_RETRIES        = AI_MAX_RETRIES;
export const GEMINI_RETRY_DELAY        = AI_RETRY_DELAY;
export const GEMINI_MAX_TOTAL_ATTEMPTS = AI_MAX_TOTAL_ATTEMPTS;
export const GEMINI_MODEL_COOLDOWN_MS  = AI_MODEL_COOLDOWN_MS;

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

// ==================== REAL-TIME CHANNEL CONTEXT ====================
// This is what lets the AI understand topics involving OTHER members
// talking to each other, not just the long-term profile of whoever is
// invoking the command. Companion memory (above) is slow-updating,
// per-user, and built from summarization -- it has no visibility into
// what's happening in the channel RIGHT NOW. This fetches the actual
// recent messages in the channel fresh on every `mokachan` call
// (never stored, purely ephemeral) so the AI can follow an ongoing
// conversation between other people and answer questions about it
// naturally, the same way a person reading the channel would.
export const RECENT_CONTEXT_MESSAGE_COUNT =
  parseInt(process.env.RECENT_CONTEXT_MESSAGE_COUNT, 10) || 8;

export const RECENT_CONTEXT_TRIM_CHARS =
  parseInt(process.env.RECENT_CONTEXT_TRIM_CHARS, 10) || 200;

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

export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// ==================== VALIDATION ====================

export function validateConfig() {
  if (!DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is not set.");
    process.exit(1);
  }

  if (!AI_API_KEY) {
    console.error(
      "AI_API_KEY (atau GEMINI_API_KEY) is not set. " +
        "Isi salah satunya di .env."
    );
    process.exit(1);
  }

  if (!AI_ENDPOINT) {
    console.error("AI_ENDPOINT is not set.");
    process.exit(1);
  }

  if (!AI_MODELS.length) {
    console.error("AI_MODELS (atau GEMINI_MODELS) kosong / tidak valid.");
    process.exit(1);
  }
}