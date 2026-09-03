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
import { handleDiskUsageCommand } from "./src/commands/diskUsage.js";
import { maybeSpawnCharacter } from "./src/characterSpawn.js";
import { recordPassiveMessage } from "./src/passiveLearning.js";
import { runMaintenance } from "./src/maintenance.js";

validateConfig();

// ==================== GLOBAL SAFETY NET ====================
// Node.js (v15+) terminates the entire process on an unhandled promise
// rejection -- including something as small as one SQLite write
// failing because disk is full. This is the last line of defense: log
// the error, but keep the bot running so it can still serve other
// commands. Without this, one small error takes down the whole bot.
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
// There used to be no listener at all for Discord connection events --
// so when the gateway died silently (zombie connection: process still
// alive, but Discord shows the bot as offline), nothing was ever
// logged. These listeners at least make a future occurrence visible in
// the logs, though the watchdog below is the main fix.
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

// ==================== AUTOMATIC MAINTENANCE ====================
// Automatic handling for disk space: incremental vacuum + disk space
// checks, no MySQL or manual intervention required. Runs once on
// startup, then repeats every MAINTENANCE_INTERVAL_MS (default 1 hour)
// for as long as the bot is running.
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

// ==================== WATCHDOG (self-healing zombie connection) ====================
// This is the main fix for "bot shows offline in Discord while the
// process is still Running in the panel" -- this happens when the
// WebSocket gateway dies silently (e.g. the hosting network connection
// drops overnight) and discord.js fails to auto-reconnect, with no
// error ever logged.
//
// How it works: periodically make a REAL call to the Discord API
// (not just check an internal status flag, which can report "healthy"
// even when the underlying socket is already dead). If it fails or
// times out several times IN A ROW, treat the connection as zombied
// and force the process to restart -- the hosting panel has already
// been confirmed to auto-restart a process that exits with an error,
// so this is a safe and effective recovery path, simpler than trying
// to manually rebuild the connection in place.
const HEALTHCHECK_INTERVAL_MS =
  parseInt(process.env.HEALTHCHECK_INTERVAL_MS, 10) || 5 * 60 * 1000; // every 5 minutes
const HEALTHCHECK_TIMEOUT_MS =
  parseInt(process.env.HEALTHCHECK_TIMEOUT_MS, 10) || 15 * 1000; // 15 seconds
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
  // If the previous check is still stuck (not finished/timed out yet),
  // don't stack another one on top of it.
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
        "Discord connection appears to be zombied (repeated consecutive failures). Forcing a restart so the panel can bring it back up..."
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

// ==================== MESSAGE HANDLER (ROUTER) ====================
// Every command goes through the same commandMatches(), so the prefix
// "m" / "M" (case-insensitive) behaves consistently across all features.

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  // ---- automatic character spawn (runs on EVERY message, not just commands) ----
  // This makes a random character appear on its own roughly every 20
  // minutes while a channel stays active, similar to the "Rimi-chan" mechanic.
  maybeSpawnCharacter(msg).catch((error) =>
    console.error("maybeSpawnCharacter error:", error.message)
  );

  // ---- passive learning (the bot gets to know each member from normal chat) ----
  // Runs across every channel the bot can access, and NEVER replies to
  // anything -- it just quietly builds a profile for each member in the background.
  recordPassiveMessage(msg).catch((error) =>
    console.error("recordPassiveMessage error:", error.message)
  );

  // Every command below is wrapped in try/catch so that if ONE command
  // fails (disk full, Gemini error, etc.), only that command fails --
  // the bot stays alive and can still serve other commands.
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

    // ---- claim character ----
    const claimCommand = `${PREFIX}${COMMANDS.claim}`;
    if (commandMatches(content, claimCommand)) {
      await handleClaimCommand(msg);
      return;
    }

    // ---- character collection ----
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

    // ---- diskusage (diagnostic) ----
    const diskUsageCommand = `${PREFIX}${COMMANDS.diskusage}`;
    if (commandMatches(content, diskUsageCommand)) {
      await handleDiskUsageCommand(msg);
      return;
    }
  } catch (error) {
    console.error(`Command "${content}" failed:`, error);

    const isDiskFull = error?.message?.includes("SQLITE_FULL");

    await msg
      .reply(
        isDiskFull
          ? "Database is full (hosting disk is out of space). Please notify an admin -- other commands may be affected until this is resolved."
          : "Something went wrong processing this command. Please try again shortly."
      )
      .catch(() => {}); // if even the reply fails, stay silent -- don't let this throw too
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