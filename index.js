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
  console.log(`✅ ${BOT_NAME} siap! Logged in sebagai ${client.user.tag}`);
  console.log(`🤖 Gemini (urutan fallback): ${GEMINI_MODELS.join(" -> ")}`);
  console.log(`⌨️ Prefix: ${PREFIX}`);
  console.log(`💬 AI command: ${PREFIX}${COMMANDS.ai}`);

  if (!NOTIFY_CHANNEL_ID) {
    console.warn("⚠️ CHANNEL_ID belum di-set.");
    return;
  }

  try {
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);

    if (channel) {
      await channel.send(`✅ Halo guys! ${BOT_NAME} siap membantu 🚀`);
    }
  } catch (error) {
    console.error("❌ Gagal mengirim notifikasi:", error.message);
  }
});

// ==================== MESSAGE HANDLER (ROUTER) ====================
// Semua command lewat commandMatches() yang sama, jadi prefix
// "m" / "M" (case-insensitive) berlaku konsisten untuk semua fitur.

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

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
      return msg.reply(`❌ Tulis pertanyaan setelah ${aiCommand}.`);
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
});

// ==================== START ====================

(async () => {
  try {
    await initDB();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("❌ Gagal menjalankan bot:", error);
    process.exit(1);
  }
})();