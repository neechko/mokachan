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

validateConfig();

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
      await channel.send(`Halo guys! ${BOT_NAME} siap membantu 🚀`);
    }
  } catch (error) {
    console.error("Gagal mengirim notifikasi:", error.message);
  }
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

  // ---- lyrics ----
  const lyricsCommand = `${PREFIX}${COMMANDS.lyrics}`;
  if (commandMatches(content, lyricsCommand)) {
    return handleLyricsCommand(msg, PREFIX, COMMANDS.lyrics, BOT_NAME);
  }

  // ---- ai ----
  const aiCommand = `${PREFIX}${COMMANDS.ai}`;
  if (commandMatches(content, aiCommand)) {
    const prompt = content.slice(aiCommand.length).trim();

    if (!prompt) {
      return msg.reply(`Tulis pertanyaan setelah ${aiCommand}.`);
    }

    return handleAiCommand(client, msg, prompt);
  }

  // ---- history ----
  const historyCommand = `${PREFIX}${COMMANDS.history}`;
  if (commandMatches(content, historyCommand)) {
    return handleHistoryCommand(msg);
  }

  // ---- clearhistory ----
  const clearHistoryCommand = `${PREFIX}${COMMANDS.clearHistory}`;
  if (commandMatches(content, clearHistoryCommand)) {
    return handleClearHistoryCommand(msg);
  }

  // ---- stats ----
  const statsCommand = `${PREFIX}${COMMANDS.stats}`;
  if (commandMatches(content, statsCommand)) {
    return handleStatsCommand(msg);
  }

  // ---- help ----
  const helpCommand = `${PREFIX}${COMMANDS.help}`;
  if (commandMatches(content, helpCommand)) {
    return handleHelpCommand(msg);
  }

  // ---- ping ----
  const pingCommand = `${PREFIX}${COMMANDS.ping}`;
  if (commandMatches(content, pingCommand)) {
    return handlePingCommand(msg);
  }

  // ---- profil (companion) ----
  const profilCommand = `${PREFIX}${COMMANDS.profil}`;
  if (commandMatches(content, profilCommand)) {
    return handleProfilCommand(msg);
  }

  // ---- resetcompanion ----
  const resetCompanionCommand = `${PREFIX}${COMMANDS.resetcompanion}`;
  if (commandMatches(content, resetCompanionCommand)) {
    return handleResetCompanionCommand(msg);
  }

  // ---- claim karakter ----
  const claimCommand = `${PREFIX}${COMMANDS.claim}`;
  if (commandMatches(content, claimCommand)) {
    return handleClaimCommand(msg);
  }

  // ---- koleksi karakter ----
  const koleksiCommand = `${PREFIX}${COMMANDS.koleksi}`;
  if (commandMatches(content, koleksiCommand)) {
    return handleKoleksiCommand(msg);
  }

  // ---- setspawnchannel (admin) ----
  const setSpawnChannelCommand = `${PREFIX}${COMMANDS.setSpawnChannel}`;
  if (commandMatches(content, setSpawnChannelCommand)) {
    return handleSetSpawnChannelCommand(msg);
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