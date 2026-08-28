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

// Daftar model, dipisah koma, dicoba BERURUTAN dari kiri ke kanan.
// Kalau model pertama kena limit/gagal, otomatis lanjut ke model berikutnya.
// Contoh .env: GEMINI_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite
// GEMINI_MODEL (tunggal, nama lama) tetap didukung untuk kompatibilitas.
export const GEMINI_MODELS = (
  process.env.GEMINI_MODELS ||
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash,gemini-3.5-flash-lite"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

// Retry PER MODEL, hanya untuk error sementara (network error / 5xx).
// 429 tidak pernah di-retry di model yang sama (lihat gemini.js).
export const GEMINI_MAX_RETRIES =
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 3;

export const GEMINI_RETRY_DELAY =
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) || 2000;

// Batas KERAS jumlah request Gemini yang benar-benar terkirim untuk
// SATU pemanggilan callGemini(), dihitung lintas SEMUA model + retry.
// Ini rem tangan utama: berapa pun banyaknya GEMINI_MODELS (mis. 10),
// jumlah request ke API tetap dibatasi angka ini per pesan user.
export const GEMINI_MAX_TOTAL_ATTEMPTS =
  parseInt(process.env.GEMINI_MAX_TOTAL_ATTEMPTS, 10) || 6;

// Setelah sebuah model kena 429, model itu "diistirahatkan" selama
// sekian ms dan tidak akan dicoba lagi (bahkan dari pesan user lain
// yang berbeda) sampai cooldown ini habis. Mencegah bot terus-menerus
// menghajar model yang sudah jelas lagi kena limit.
export const GEMINI_MODEL_COOLDOWN_MS =
  parseInt(process.env.GEMINI_MODEL_COOLDOWN_MS, 10) || 60000;

// ==================== COMPANION MEMORY (rolling summary) ====================
// Menggantikan cara lama "kirim ulang N history mentah tiap request".
// Sekarang cuma kirim: system persona + ringkasan singkat + fakta penting
// + SATU turn terakhir (untuk kelancaran alur) + prompt baru.
// Ringkasan di-update sendiri oleh AI setiap SUMMARY_EVERY_N_TURNS giliran,
// jadi biaya token hampir konstan walau chat sudah ratusan kali.

export const SUMMARY_EVERY_N_TURNS =
  parseInt(process.env.SUMMARY_EVERY_N_TURNS, 10) || 6;

export const MAX_FACTS = parseInt(process.env.MAX_FACTS, 10) || 8;

export const AFFECTION_PER_TURN =
  parseInt(process.env.AFFECTION_PER_TURN, 10) || 1;

// ==================== CLAIM KARAKTER ANIME (spawn ala Rimi-chan) ====================
// Setiap channel aktif chat, karakter random dari AniList akan muncul
// otomatis setiap CHARACTER_SPAWN_INTERVAL_MS (default 20 menit), dan
// SIAPAPUN yang paling cepat ketik command claim akan mendapatkannya.
// Kalau tidak ada yang klaim dalam CHARACTER_SPAWN_TIMEOUT_MS, spawn
// hangus dan channel tsb bisa spawn baru lagi setelah interval berikutnya.

export const CHARACTER_SPAWN_INTERVAL_MS =
  parseInt(process.env.CHARACTER_SPAWN_INTERVAL_MS, 10) || 20 * 60 * 1000;

export const CHARACTER_SPAWN_TIMEOUT_MS =
  parseInt(process.env.CHARACTER_SPAWN_TIMEOUT_MS, 10) || 10 * 60 * 1000;

// Channel default tempat karakter muncul (opsional, bisa diisi di .env).
// Kalau kosong, admin WAJIB set lewat command `msetspawnchannel` dulu
// sebelum spawn otomatis aktif -- supaya tidak nyebar ke semua channel.
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
  setSpawnChannel: process.env.CMD_SETSPAWNCHANNEL || "setspawnchannel",
};

// ==================== VALIDATION ====================

export function validateConfig() {
  if (!DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN belum diatur.");
    process.exit(1);
  }

  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY belum diatur.");
    process.exit(1);
  }
}