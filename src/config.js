import dotenv from "dotenv";

dotenv.config();

// ==================== DATABASE ====================
export const DATABASE_URL = process.env.DATABASE_URL;
export const USE_POSTGRES = !!DATABASE_URL;

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
// (e.g. directly granting a character card). Unlike server "Manage Server"
// permission checks, this is tied to one specific person regardless of
// which server the command is run in.
export const OWNER_ID = process.env.OWNER_ID || null;

// ==================== HISTORY / OUTPUT ====================

export const HISTORY_COUNT = parseInt(process.env.HISTORY_COUNT, 10) || 5;

// How many raw history rows (mhistory) are kept PER USER before being
// auto-deleted. This history is only for manual review -- NOT the AI
// context source (that's companion_memory's job) -- so it's safe to
// keep bounded.
export const HISTORY_RETAIN_COUNT =
  parseInt(process.env.HISTORY_RETAIN_COUNT, 10) || 30;

export const TRIM_CHARS = parseInt(process.env.TRIM_CHARS, 10) || 700;
export const MAX_OUTPUT_CHARS =
  parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 1800;

// ==================== AI PROVIDER (universal, OpenAI-compatible) ====================
//
// All providers below are compatible with the "OpenAI Chat Completions"
// format -- just change 3 lines in .env (AI_ENDPOINT, AI_API_KEY,
// AI_MODELS) without touching any .js files:
//
//   NVIDIA Nemotron:
//     AI_ENDPOINT=https://integrate.api.nvidia.com/v1/chat/completions
//     AI_API_KEY=nvapi-xxxx
//     AI_MODELS=nvidia/nemotron-3-ultra-550b-a55b,...
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
//   Gemini (via OpenAI-compatible endpoint):
//     AI_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
//     AI_API_KEY=AIzaSy...
//     AI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite

// Endpoint -- if empty, falls back to NVIDIA so the bot still starts.
export const AI_ENDPOINT =
  process.env.AI_ENDPOINT ||
  "https://integrate.api.nvidia.com/v1/chat/completions";

// API key. Priority: AI_API_KEY -> GEMINI_API_KEY (legacy .env compat).
export const AI_API_KEY =
  process.env.AI_API_KEY || process.env.GEMINI_API_KEY;

// Model list, comma-separated, tried left to right.
// Priority: AI_MODELS -> GEMINI_MODELS -> GEMINI_MODEL (legacy).
export const AI_MODELS = (
  process.env.AI_MODELS ||
  process.env.GEMINI_MODELS ||
  process.env.GEMINI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b,nvidia/nemotron-nano-9b-v2"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Retry PER MODEL, only for transient errors (network / 5xx).
// 429 is NOT retried on the same model (immediate fallback).
export const AI_MAX_RETRIES =
  parseInt(process.env.AI_MAX_RETRIES, 10) ||
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) ||
  3;

export const AI_RETRY_DELAY =
  parseInt(process.env.AI_RETRY_DELAY, 10) ||
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) ||
  2000;

// Hard cap on actual requests for ONE callGemini() call, counted
// across all models + retries. This is the main brake: no matter how
// long AI_MODELS is, total requests per user message is capped here.
export const AI_MAX_TOTAL_ATTEMPTS =
  parseInt(process.env.AI_MAX_TOTAL_ATTEMPTS, 10) ||
  parseInt(process.env.GEMINI_MAX_TOTAL_ATTEMPTS, 10) ||
  6;

// After a 429, the model is "rested" for this duration (ms) and won't
// be used again (even by other users) until the cooldown expires.
export const AI_MODEL_COOLDOWN_MS =
  parseInt(process.env.AI_MODEL_COOLDOWN_MS, 10) ||
  parseInt(process.env.GEMINI_MODEL_COOLDOWN_MS, 10) ||
  60000;

// ---- Compatibility aliases: so gemini.js & old files still work ----
export const GEMINI_API_KEY            = AI_API_KEY;
export const GEMINI_MODELS             = AI_MODELS;
export const GEMINI_MAX_RETRIES        = AI_MAX_RETRIES;
export const GEMINI_RETRY_DELAY        = AI_RETRY_DELAY;
export const GEMINI_MAX_TOTAL_ATTEMPTS = AI_MAX_TOTAL_ATTEMPTS;
export const GEMINI_MODEL_COOLDOWN_MS  = AI_MODEL_COOLDOWN_MS;

// ==================== COMPANION MEMORY (rolling summary) ====================
// Only sends: system persona + short summary + key facts + ONE last
// turn + the new prompt. The summary is updated by the AI itself every
// SUMMARY_EVERY_N_TURNS turns, so token cost stays roughly constant.

export const SUMMARY_EVERY_N_TURNS =
  parseInt(process.env.SUMMARY_EVERY_N_TURNS, 10) || 6;

export const MAX_FACTS = parseInt(process.env.MAX_FACTS, 10) || 8;

// Legacy affection system (kept for backward compatibility).
// The new relationship system uses REL_XP_BASE below instead.
export const AFFECTION_PER_TURN =
  parseInt(process.env.AFFECTION_PER_TURN, 10) || 1;

// ==================== RELATIONSHIP XP / LEVEL ====================
// Sistem ini mengatur seberapa cepat user bisa membangun kedekatan dengan bot.
// Semakin tinggi angkanya, semakin cepat user naik level.

// XP dasar yang didapat user untuk setiap pesan bermakna (command mchan).
// Pesan harus: >12 karakter, tidak spam, tidak diulang dalam 30 menit.
// Contoh: REL_XP_BASE=4 → user dapat 4 XP per pesan normal
export const REL_XP_BASE =
  parseInt(process.env.REL_XP_BASE, 10) || 4;

// Batas maksimal XP yang bisa didapat user dalam 1 hari (reset setiap tengah malam).
// Mencegah user "speedrun" level dengan spam chat seharian.
// Contoh: REL_XP_DAILY_CAP=60 → setelah dapat 60 XP, pesan berikutnya tidak dapat XP lagi sampai besok
export const REL_XP_DAILY_CAP =
  parseInt(process.env.REL_XP_DAILY_CAP, 10) || 60;

// Level tertinggi yang bisa dicapai user. Setelah level ini, XP tetap naik tapi tidak ada level lagi.
// Contoh: REL_MAX_LEVEL=30 → user bisa mencapai level 1-30
export const REL_MAX_LEVEL =
  parseInt(process.env.REL_MAX_LEVEL, 10) || 30;

// XP yang didapat dari chat biasa (tanpa command mchan) melalui passive learning.
// Bot diam-diam belajar dari chat user dan memberi XP kecil.
// Contoh: REL_PASSIVE_XP=1 → user dapat 1 XP dari chat biasa
export const REL_PASSIVE_XP =
  parseInt(process.env.REL_PASSIVE_XP, 10) || 1;

// Jeda waktu minimal (dalam detik) antar pesan agar user bisa dapat XP.
// Mencegah spam: jika user kirim pesan terlalu cepat, tidak dapat XP.
// Contoh: REL_MIN_GAP_SECONDS=90 → user harus tunggu 90 detik antar pesan
export const REL_MIN_GAP_SECONDS =
  parseInt(process.env.REL_MIN_GAP_SECONDS, 10) || 90;

// Koefisien kurva XP. Menentukan seberapa curam kenaikan XP yang dibutuhkan untuk naik level.
// Rumus: XP yang dibutuhkan = REL_XP_CURVE × (Level - 1)²
// Semakin tinggi angkanya, semakin sulit naik level tinggi.
// Contoh: REL_XP_CURVE=100 → Level 2 butuh 100 XP, Level 3 butuh 400 XP, Level 10 butuh 8,100 XP
export const REL_XP_CURVE =
  parseInt(process.env.REL_XP_CURVE, 10) || 100;

// ==================== PASSIVE LEARNING ====================
// The bot quietly "listens" to ordinary chat (NOT commands) across
// every channel it can access. Once PASSIVE_LEARN_BATCH_SIZE messages
// accumulate from one user, it summarizes them into the SAME
// companion_memory used by the AI command -- so profiles stay unified.
// This never triggers a reply, it just learns quietly in the background.

export const PASSIVE_LEARN_BATCH_SIZE =
  parseInt(process.env.PASSIVE_LEARN_BATCH_SIZE, 10) || 12;

export const PASSIVE_LEARN_MIN_LENGTH =
  parseInt(process.env.PASSIVE_LEARN_MIN_LENGTH, 10) || 4;

// ==================== REAL-TIME CHANNEL CONTEXT ====================
// Fetches the actual recent messages in the channel fresh on every
// AI command call (never stored, purely ephemeral) so the AI can
// follow an ongoing conversation between other people naturally.

export const RECENT_CONTEXT_MESSAGE_COUNT =
  parseInt(process.env.RECENT_CONTEXT_MESSAGE_COUNT, 10) || 8;

export const RECENT_CONTEXT_TRIM_CHARS =
  parseInt(process.env.RECENT_CONTEXT_TRIM_CHARS, 10) || 200;

// ==================== ANIME CHARACTER CLAIM (Rimi-chan-style spawn) ====================
// While a server has chat activity, a random character from AniList
// automatically appears every CHARACTER_SPAWN_INTERVAL_MS (default 20
// minutes), and whoever types the claim command first gets it.

export const CHARACTER_SPAWN_INTERVAL_MS =
  parseInt(process.env.CHARACTER_SPAWN_INTERVAL_MS, 10) || 20 * 60 * 1000;

export const CHARACTER_SPAWN_TIMEOUT_MS =
  parseInt(process.env.CHARACTER_SPAWN_TIMEOUT_MS, 10) || 10 * 60 * 1000;

// Default channel where characters appear (optional). If empty, an
// admin MUST set it via `msetspawnchannel` first before automatic
// spawning activates.
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
  setSpawnChannel: process.env.CMD_SETSPAWNCHANNEL || "setspawnchannel",
  admincard: process.env.CMD_ADMINCARD || "admincard",
  setNickname: process.env.CMD_SETNICKNAME || "setnickname", 
};

// ==================== WEB SEARCH ====================
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// ==================== VALIDATION ====================

export function validateConfig() {
  if (!DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is not set.");
    process.exit(1);
  }

  if (!AI_API_KEY) {
    console.error(
      "AI_API_KEY (or GEMINI_API_KEY) is not set. " +
        "Set one of them in .env."
    );
    process.exit(1);
  }

  if (!AI_ENDPOINT) {
    console.error("AI_ENDPOINT is not set.");
    process.exit(1);
  }

  if (!AI_MODELS.length) {
    console.error("AI_MODELS (or GEMINI_MODELS) is empty or invalid.");
    process.exit(1);
  }
}