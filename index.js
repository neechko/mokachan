import { Client, GatewayIntentBits } from "discord.js";
import {
  DISCORD_TOKEN,
  NOTIFY_CHANNEL_ID,
  BOT_NAME,
  PREFIX,
  COMMANDS,
  GEMINI_MODELS,
  validateConfig,
} from "./src/config.js";
import { commandMatches } from "./src/commandMatcher.js";
import { initDB } from "./src/database.js";
import { handleAiCommand } from "./src/commands/ai.js";
import { handleHistoryCommand } from "./src/commands/history.js";
import { handleClearHistoryCommand } from "./src/commands/clearHistory.js";
import { handleStatsCommand } from "./src/commands/stats.js";
import { handleHelpCommand } from "./src/commands/help.js";
import { handlePingCommand } from "./src/commands/ping.js";
import { handleLyricsCommand } from "./lyrics.js";
import { handleClaimCommand } from "./src/commands/claim.js";
import { handleKoleksiCommand } from "./src/commands/koleksi.js";
import { handleProfilCommand } from "./src/commands/profil.js";
import { handleResetCompanionCommand } from "./src/commands/resetCompanion.js";
import { handleSetSpawnChannelCommand } from "./src/commands/setSpawnChannel.js";
import { maybeSpawnCharacter } from "./src/characterSpawn.js";
import { recordPassiveMessage } from "./src/passiveLearning.js";
import { runMaintenance } from "./src/maintenance.js";

validateConfig();

// ==================== SAFETY NET GLOBAL ====================
// Node.js (v15+) akan MEMATIKAN SELURUH PROSES kalau ada promise yang
// reject tanpa ditangkap (unhandled rejection) -- termasuk hal sepele
// seperti 1 query SQLite yang gagal gara-gara disk penuh. Ini jaring
// pengaman terakhir: log errornya, TAPI bot tetap hidup dan tetap bisa
// melayani command lain. Tanpa ini, satu error kecil = bot mati total.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (bot tetap jalan):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (bot tetap jalan):", error);
});

// ==================== DISCORD CLIENT ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ==================== READY ====================

client.once("ready", async () => {
  console.log(`${BOT_NAME} siap! Logged in sebagai ${client.user.tag}`);
  console.log(`Gemini (urutan fallback): ${GEMINI_MODELS.join(" -> ")}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log(`AI command: ${PREFIX}${COMMANDS.ai}`);

  if (!NOTIFY_CHANNEL_ID) {
    console.warn("CHANNEL_ID belum di-set.");
    return;
  }

  try {
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);

    if (channel) {
      await channel.send(`Halo guys! ${BOT_NAME} siap membantu`);
    }
  } catch (error) {
    console.error("Gagal mengirim notifikasi:", error.message);
  }
});

// ==================== MAINTENANCE OTOMATIS ====================
// Solusi otomatis buat disk penuh: VACUUM database + cek sisa disk
// space berkala, tanpa perlu MySQL/campur tangan manual. Jalan sekali
// pas bot start, lalu berulang tiap MAINTENANCE_INTERVAL_MS (default 6
// jam) selama bot hidup.
const MAINTENANCE_INTERVAL_MS =
  parseInt(process.env.MAINTENANCE_INTERVAL_MS, 10) || 6 * 60 * 60 * 1000;

client.once("ready", () => {
  runMaintenance(client).catch((error) =>
    console.error("runMaintenance error:", error.message)
  );

  setInterval(() => {
    runMaintenance(client).catch((error) =>
      console.error("runMaintenance error:", error.message)
    );
  }, MAINTENANCE_INTERVAL_MS);
});

// ==================== MESSAGE HANDLER (ROUTER) ====================
// Semua command lewat commandMatches() yang sama, jadi prefix
// "m" / "M" (case-insensitive) berlaku konsisten untuk semua fitur.

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  // ---- spawn karakter otomatis (jalan di SEMUA pesan, bukan cuma command) ----
  // Ini yang bikin karakter random muncul sendiri tiap ~20 menit selama
  // channel-nya aktif chat, mirip mekanisme bot "Rimi-chan".
  maybeSpawnCharacter(msg).catch((error) =>
    console.error("maybeSpawnCharacter error:", error.message)
  );

  // ---- belajar pasif (Moka mengenal tiap member dari chat biasa) ----
  // Jalan di semua channel yang bot punya akses, TIDAK pernah membalas
  // apapun -- cuma diam-diam membangun profil tiap member di belakang layar.
  recordPassiveMessage(msg).catch((error) =>
    console.error("recordPassiveMessage error:", error.message)
  );

  // Semua command di bawah ini dibungkus try/catch supaya kalau SATU
  // command gagal (misal disk penuh, Gemini error, dsb), cuma command
  // itu yang gagal -- bot tetap hidup dan tetap bisa layani command lain.
  try {
    // ---- lyrics ----
    const lyricsCommand = `${PREFIX}${COMMANDS.lyrics}`;
    if (commandMatches(content, lyricsCommand)) {
      await handleLyricsCommand(msg, PREFIX, COMMANDS.lyrics, BOT_NAME);
      return;
    }

    // ---- ai ----
    const aiCommand = `${PREFIX}${COMMANDS.ai}`;
    if (commandMatches(content, aiCommand)) {
      const prompt = content.slice(aiCommand.length).trim();

      if (!prompt) {
        await msg.reply(`Tulis pertanyaan setelah ${aiCommand}.`);
        return;
      }

      await handleAiCommand(client, msg, prompt);
      return;
    }

    // ---- history ----
    const historyCommand = `${PREFIX}${COMMANDS.history}`;
    if (commandMatches(content, historyCommand)) {
      await handleHistoryCommand(msg);
      return;
    }

    // ---- clearhistory ----
    const clearHistoryCommand = `${PREFIX}${COMMANDS.clearHistory}`;
    if (commandMatches(content, clearHistoryCommand)) {
      await handleClearHistoryCommand(msg);
      return;
    }

    // ---- stats ----
    const statsCommand = `${PREFIX}${COMMANDS.stats}`;
    if (commandMatches(content, statsCommand)) {
      await handleStatsCommand(msg);
      return;
    }

    // ---- help ----
    const helpCommand = `${PREFIX}${COMMANDS.help}`;
    if (commandMatches(content, helpCommand)) {
      await handleHelpCommand(msg);
      return;
    }

    // ---- ping ----
    const pingCommand = `${PREFIX}${COMMANDS.ping}`;
    if (commandMatches(content, pingCommand)) {
      await handlePingCommand(msg);
      return;
    }

    // ---- profil (companion) ----
    const profilCommand = `${PREFIX}${COMMANDS.profil}`;
    if (commandMatches(content, profilCommand)) {
      await handleProfilCommand(msg);
      return;
    }

    // ---- resetcompanion ----
    const resetCompanionCommand = `${PREFIX}${COMMANDS.resetcompanion}`;
    if (commandMatches(content, resetCompanionCommand)) {
      await handleResetCompanionCommand(msg);
      return;
    }

    // ---- claim karakter ----
    const claimCommand = `${PREFIX}${COMMANDS.claim}`;
    if (commandMatches(content, claimCommand)) {
      await handleClaimCommand(msg);
      return;
    }

    // ---- koleksi karakter ----
    const koleksiCommand = `${PREFIX}${COMMANDS.koleksi}`;
    if (commandMatches(content, koleksiCommand)) {
      await handleKoleksiCommand(msg);
      return;
    }

    // ---- setspawnchannel (admin) ----
    const setSpawnChannelCommand = `${PREFIX}${COMMANDS.setSpawnChannel}`;
    if (commandMatches(content, setSpawnChannelCommand)) {
      await handleSetSpawnChannelCommand(msg);
      return;
    }
  } catch (error) {
    console.error(`Command "${content}" gagal diproses:`, error);

    const isDiskFull = error?.message?.includes("SQLITE_FULL");

    await msg
      .reply(
        isDiskFull
          ? "Database lagi penuh (disk hosting habis). Kabari admin server ya, command lain mungkin masih kena imbas juga sampai ini dibereskan."
          : "Ada error waktu proses command ini. Coba lagi sebentar lagi."
      )
      .catch(() => {}); // kalau reply pun gagal, cukup diam -- jangan sampai ini juga nge-throw
  }
});

// ==================== START ====================

(async () => {
  try {
    await initDB();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("Gagal menjalankan bot:", error);
    process.exit(1);
  }
})();