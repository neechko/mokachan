// ==================== AUTOMATIC CHARACTER SPAWN ====================
// Similar to the "Rimi-chan" mechanic: while the SERVER has activity
// (in ANY channel), every CHARACTER_SPAWN_INTERVAL_MS (default 20
// minutes) since the last spawn/claim, a random character from AniList
// automatically appears in the OFFICIAL channel set by an admin
// (msetspawnchannel). Whoever types the claim command first gets it.
// If nobody claims it within CHARACTER_SPAWN_TIMEOUT_MS, the spawn
// expires and a new one can appear later.
//
// FIX NOTE: an earlier version only counted activity when a message
// was sent in the spawn channel itself (`if (msg.channel.id !==
// spawnChannelId) return`), so chat in other channels never advanced
// the timer. Now ANY message in ANY channel of the server counts as
// activity, but the character is still always sent to the official
// channel (not the channel the triggering message came from).

import discordjs from "discord.js";
const { EmbedBuilder } = discordjs;
import {
  CHARACTER_SPAWN_INTERVAL_MS,
  CHARACTER_SPAWN_TIMEOUT_MS,
  DEFAULT_SPAWN_CHANNEL_ID,
  PREFIX,
  COMMANDS,
  BOT_NAME,
} from "./config.js";
import {
  getActiveSpawn,
  setSpawn,
  clearSpawn,
  touchSpawnTimer,
  getSetting,
} from "./database.js";
import { fetchRandomCharacterWithRetry, RARITY_LABEL } from "./anilist.js";

// In-memory guard so two messages arriving almost simultaneously don't
// both pass the "time to spawn" check and trigger two AniList fetches.
const spawnLocks = new Set();

// Caches the official spawn channel so we don't query the DB on every
// single message. Refreshed every 30 seconds, and invalidated
// instantly when an admin runs `msetspawnchannel` (see
// invalidateSpawnChannelCache).
let cachedSpawnChannelId = DEFAULT_SPAWN_CHANNEL_ID;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

export function invalidateSpawnChannelCache() {
  cacheLoadedAt = 0;
}

// Exported so claim.js knows which channel key the active spawn is
// stored under -- spawn state is no longer keyed by the sender's
// channel, always by the official channel.
export async function getSpawnChannelId() {
  const now = Date.now();
  if (now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedSpawnChannelId;
  }

  const stored = await getSetting("spawn_channel_id");
  cachedSpawnChannelId = stored || DEFAULT_SPAWN_CHANNEL_ID;
  cacheLoadedAt = now;

  return cachedSpawnChannelId;
}

function isTimedOut(spawnedAt) {
  if (!spawnedAt) return false;
  return Date.now() - new Date(spawnedAt).getTime() >= CHARACTER_SPAWN_TIMEOUT_MS;
}

function isDueForSpawn(lastSpawnAt) {
  if (!lastSpawnAt) return true;
  return Date.now() - new Date(lastSpawnAt).getTime() >= CHARACTER_SPAWN_INTERVAL_MS;
}

function buildSpawnEmbed(character) {
  const label = RARITY_LABEL[character.rarity] || "[Common]";

  return new EmbedBuilder()
    .setTitle("A character appeared!")
    .setDescription(
      `**${character.name}** ${label}\n` +
        `From: *${character.series}*\n\n` +
        `Type \`${PREFIX}${COMMANDS.claim}\` quickly to claim it!`
    )
    .setImage(character.image)
    .setColor(0x5865f2)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();
}

// Called on EVERY incoming message in any server/channel (not just
// commands) to track activity and trigger a spawn when it's due.
// Activity is counted from any channel, but the spawn result is
// always sent to the official channel.
export async function maybeSpawnCharacter(msg) {
  if (!msg.guild) return;

  const spawnChannelId = await getSpawnChannelId();

  // No official channel set by an admin yet -- do not spawn anywhere
  // until it's configured via `msetspawnchannel`.
  if (!spawnChannelId) return;

  if (spawnLocks.has(spawnChannelId)) return;

  // IMPORTANT: state (timer, active spawn) is always stored under the
  // key `spawnChannelId`, NOT `msg.channel.id`. So chat in any channel
  // still advances the same timer.
  const existing = await getActiveSpawn(spawnChannelId);

  // This official channel's row does not exist yet -- start the
  // timer, but do NOT spawn immediately on the first message that
  // triggers this.
  if (!existing) {
    await touchSpawnTimer(spawnChannelId);
    return;
  }

  // There is an active spawn that hasn't been claimed yet.
  if (existing.anilist_id) {
    if (isTimedOut(existing.spawned_at)) {
      // Expired because nobody claimed it in time.
      await clearSpawn(spawnChannelId);
    }
    return; // don't spawn a new one while the current one is still live
  }

  if (!isDueForSpawn(existing.last_spawn_at)) return;

  spawnLocks.add(spawnChannelId);

  try {
    const character = await fetchRandomCharacterWithRetry();
    if (!character) return;

    // Fetch the official channel object directly (NOT msg.channel),
    // since the triggering message may have come from a different
    // channel entirely.
    const targetChannel = await msg.client.channels
      .fetch(spawnChannelId)
      .catch(() => null);

    if (!targetChannel || !targetChannel.send) {
      console.error(
        "Official spawn channel not found or not accessible. Check the result of `msetspawnchannel`."
      );
      return;
    }

    await setSpawn(spawnChannelId, character);
    await targetChannel.send({ embeds: [buildSpawnEmbed(character)] });
  } catch (error) {
    console.error("Character spawn failed:", error.message);
  } finally {
    spawnLocks.delete(spawnChannelId);
  }
}