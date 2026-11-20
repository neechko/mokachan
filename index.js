import discordjs from "discord.js";
const { Client, GatewayIntentBits } = discordjs;

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
import { handleAdminCardCommand } from "./src/commands/adminCard.js";

import { maybeSpawnCharacter } from "./src/characterSpawn.js";
import { recordPassiveMessage } from "./src/passiveLearning.js";
import { handleDiskUsageCommand } from "./src/commands/diskUsage.js";
import { runMaintenance } from "./src/maintenance.js";
import { handleSetNicknameCommand } from "./src/commands/setNickname.js";

validateConfig();

// ==================== GLOBAL SAFETY NET ====================

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (bot stays alive):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (bot stays alive):", error);
});

// ==================== DISCORD CLIENT ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ==================== CONNECTION DIAGNOSTICS ====================

client.on("error", (error) => {
  console.error("Discord client error:", error.message);
});

client.on("warn", (info) => {
  console.warn("Discord client warning:", info);
});

client.on("shardError", (error, shardId) => {
  console.error(`Shard ${shardId} error:`, error.message);
});

client.on("shardDisconnect", (event, shardId) => {
  console.warn(
    `Shard ${shardId} disconnected -- code: ${event.code}, reason: ${event.reason}`
  );
});

client.on("shardReconnecting", (shardId) => {
  console.log(`Shard ${shardId} reconnecting...`);
});

client.on("shardResume", (shardId, replayedEvents) => {
  console.log(`Shard ${shardId} resumed, ${replayedEvents} events replayed.`);
});

// ==================== READY ====================

client.once("clientReady", async () => {
  console.log(`${BOT_NAME} is ready. Logged in as ${client.user.tag}`);
  console.log(`Gemini fallback order: ${GEMINI_MODELS.join(" -> ")}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log(`AI command: ${PREFIX}${COMMANDS.ai}`);

  if (process.env.DATABASE_URL) {
    console.log("Database: Neon PostgreSQL aktif.");
  } else {
    console.log("Database: DATABASE_URL tidak diset.");
  }

  if (!NOTIFY_CHANNEL_ID) {
    console.warn("CHANNEL_ID is not set.");
    return;
  }

  try {
    const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);

    if (channel) {
      await channel.send(`${BOT_NAME} is online and ready.`);
    }
  } catch (error) {
    console.error("Failed to send startup notification:", error.message);
  }
});

// ==================== AUTOMATIC HOSTING DISK MAINTENANCE ====================

const MAINTENANCE_INTERVAL_MS =
  parseInt(process.env.MAINTENANCE_INTERVAL_MS, 10) || 60 * 60 * 1000;

client.once("clientReady", () => {
  runMaintenance(client).catch((error) =>
    console.error("runMaintenance error:", error.message)
  );

  setInterval(() => {
    runMaintenance(client).catch((error) =>
      console.error("runMaintenance error:", error.message)
    );
  }, MAINTENANCE_INTERVAL_MS);
});

// ==================== WATCHDOG ====================

const HEALTHCHECK_INTERVAL_MS =
  parseInt(process.env.HEALTHCHECK_INTERVAL_MS, 10) || 5 * 60 * 1000;

const HEALTHCHECK_TIMEOUT_MS =
  parseInt(process.env.HEALTHCHECK_TIMEOUT_MS, 10) || 15 * 1000;

const HEALTHCHECK_MAX_FAILURES =
  parseInt(process.env.HEALTHCHECK_MAX_FAILURES, 10) || 3;

let consecutiveHealthFailures = 0;
let healthCheckInFlight = false;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function runHealthCheck() {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;

  try {
    await withTimeout(
      client.user.fetch(),
      HEALTHCHECK_TIMEOUT_MS,
      "Health check"
    );

    if (consecutiveHealthFailures > 0) {
      console.log("Discord connection recovered after previous failures.");
    }

    consecutiveHealthFailures = 0;
  } catch (error) {
    consecutiveHealthFailures += 1;

    console.error(
      `Discord connection health check failed (${consecutiveHealthFailures}/${HEALTHCHECK_MAX_FAILURES}):`,
      error.message
    );

    if (consecutiveHealthFailures >= HEALTHCHECK_MAX_FAILURES) {
      console.error(
        "Discord connection appears to be zombied. Forcing restart..."
      );
      process.exit(1);
    }
  } finally {
    healthCheckInFlight = false;
  }
}

client.once("clientReady", () => {
  setInterval(runHealthCheck, HEALTHCHECK_INTERVAL_MS);
});

// ==================== MESSAGE HANDLER ====================

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  maybeSpawnCharacter(msg).catch((error) =>
    console.error("maybeSpawnCharacter error:", error.message)
  );

  recordPassiveMessage(msg).catch((error) => {
    console.error("recordPassiveMessage error:", error.message);
  });

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
        await msg.reply(`Write a question after ${aiCommand}.`);
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

    // ---- profil ----
    const profilCommand = `${PREFIX}${COMMANDS.profil}`;
    if (commandMatches(content, profilCommand)) {
      await handleProfilCommand(msg);
      return;
    }

       // ---- setnickname ----
   const setNicknameCommand = `${PREFIX}${COMMANDS.setNickname}`;
   if (commandMatches(content, setNicknameCommand)) {
     const rawArgs = content.slice(setNicknameCommand.length).trim();
     await handleSetNicknameCommand(msg, rawArgs);
     return;
   }

    // ---- resetcompanion ----
    const resetCompanionCommand = `${PREFIX}${COMMANDS.resetcompanion}`;
    if (commandMatches(content, resetCompanionCommand)) {
      await handleResetCompanionCommand(msg);
      return;
    }

    // ---- claim ----
    const claimCommand = `${PREFIX}${COMMANDS.claim}`;
    if (commandMatches(content, claimCommand)) {
      await handleClaimCommand(msg);
      return;
    }

    // ---- koleksi ----
    const koleksiCommand = `${PREFIX}${COMMANDS.koleksi}`;
    if (commandMatches(content, koleksiCommand)) {
      await handleKoleksiCommand(msg);
      return;
    }

    // ---- setspawnchannel ----
    const setSpawnChannelCommand = `${PREFIX}${COMMANDS.setSpawnChannel}`;
    if (commandMatches(content, setSpawnChannelCommand)) {
      await handleSetSpawnChannelCommand(msg);
      return;
    }

    // ---- diskusage: cek disk hosting + ukuran database Neon ----
    const diskUsageCommand = `${PREFIX}${COMMANDS.diskusage}`;
    if (commandMatches(content, diskUsageCommand)) {
      await handleDiskUsageCommand(msg);
      return;
    }

    // ---- vacuumconvert: tidak diperlukan lagi di Neon ----
    const vacuumConvertCommand = `${PREFIX}${COMMANDS.vacuumconvert}`;
    if (commandMatches(content, vacuumConvertCommand)) {
      await msg.reply(
        "Database sekarang memakai Neon PostgreSQL. Vacuum SQLite tidak diperlukan lagi karena PostgreSQL memakai autovacuum."
      );
      return;
    }

    // ---- admincard ----
    const adminCardCommand = `${PREFIX}${COMMANDS.admincard}`;
    if (commandMatches(content, adminCardCommand)) {
      const rawArgs = content.slice(adminCardCommand.length).trim();
      await handleAdminCardCommand(msg, rawArgs);
      return;
    }
  } catch (error) {
    console.error(`Command "${content}" failed:`, error);

    await msg
      .reply(
        "Something went wrong processing this command. Please try again shortly."
      )
      .catch(() => { });
  }
});

// ==================== START ====================

(async () => {
  try {
    await initDB();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("Failed to start the bot:", error);
    process.exit(1);
  }
})();