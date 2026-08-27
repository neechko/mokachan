import dotenv from "dotenv";

dotenv.config();

// ==================== CORE ====================

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const NOTIFY_CHANNEL_ID = process.env.CHANNEL_ID;

export const BOT_NAME = process.env.BOT_NAME || "mokachan";
export const PREFIX = process.env.COMMAND_PREFIX || "m";
export const COMMAND_CASE_INSENSITIVE =
  process.env.COMMAND_CASE_INSENSITIVE === "true";

// ==================== HISTORY / OUTPUT ====================

export const HISTORY_COUNT = parseInt(process.env.HISTORY_COUNT, 10) || 5;
export const TRIM_CHARS = parseInt(process.env.TRIM_CHARS, 10) || 700;
export const MAX_OUTPUT_CHARS =
  parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 1800;

// ==================== GEMINI ====================

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
export const GEMINI_MAX_RETRIES =
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 4;
export const GEMINI_RETRY_DELAY =
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) || 2000;

// ==================== COMMANDS ====================

export const COMMANDS = {
  ai: process.env.CMD_MOKACHAN || "mokachan",
  lyrics: process.env.CMD_LYRICS || "lyrics",
  history: process.env.CMD_HISTORY || "history",
  clearHistory: process.env.CMD_CLEARHISTORY || "clearhistory",
  stats: process.env.CMD_STATS || "stats",
  ping: process.env.CMD_PING || "ping",
  help: process.env.CMD_HELP || "help",
};

// ==================== VALIDATION ====================

export function validateConfig() {
  if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN belum diatur.");
    process.exit(1);
  }

  if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY belum diatur.");
    process.exit(1);
  }
}
