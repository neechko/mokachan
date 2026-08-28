// ==================== SPAWN KARAKTER OTOMATIS ====================
// Mirip mekanisme "Rimi-chan": selama channel ada yang chat, setiap
// CHARACTER_SPAWN_INTERVAL_MS (default 20 menit) sejak spawn/klaim
// terakhir, karakter random dari AniList otomatis muncul di channel
// itu. Siapapun yang paling cepat ketik command claim akan mendapatkannya.
// Kalau tidak ada yang klaim dalam CHARACTER_SPAWN_TIMEOUT_MS, spawn
// hangus dan channel bisa dapat spawn baru lagi.

import { EmbedBuilder } from "discord.js";
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
import { fetchRandomCharacterWithRetry, RARITY_EMOJI } from "./anilist.js";

// Guard di memori supaya 2 pesan yang datang nyaris bersamaan di
// channel yang sama tidak sama-sama lolos cek "waktunya spawn" dan
// memicu 2 fetch AniList sekaligus.
const spawnLocks = new Set();

// Cache channel spawn resmi supaya tidak query DB di SETIAP pesan.
// Di-refresh tiap 30 detik, dan langsung di-update instan waktu admin
// pakai command `msetspawnchannel` (lihat invalidateSpawnChannelCache).
let cachedSpawnChannelId = DEFAULT_SPAWN_CHANNEL_ID;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

export function invalidateSpawnChannelCache() {
  cacheLoadedAt = 0;
}

async function getSpawnChannelId() {
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
  const emoji = RARITY_EMOJI[character.rarity] || "⚪";

  return new EmbedBuilder()
    .setTitle(`${emoji} Seorang karakter muncul!`)
    .setDescription(
      `**${character.name}**\n` +
        `Dari: *${character.series}*\n` +
        `Rarity: **${character.rarity}**\n\n` +
        `Ketik \`${PREFIX}${COMMANDS.claim}\` secepatnya untuk klaim!`
    )
    .setImage(character.image)
    .setColor(0xff69b4)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();
}

// Dipanggil di SETIAP pesan masuk (bukan cuma command) untuk melacak
// aktivitas channel dan memicu spawn kalau sudah waktunya.
export async function maybeSpawnCharacter(msg) {
  if (!msg.guild || !msg.channel?.send) return;

  const spawnChannelId = await getSpawnChannelId();

  // Belum ada channel resmi yang diatur admin -> jangan spawn di
  // channel manapun. Ini yang memperbaiki masalah spawn "nyebar" ke
  // semua channel yang ada chat.
  if (!spawnChannelId) return;

  // Bukan channel resmi -> abaikan total, jangan sentuh timer sama sekali.
  if (msg.channel.id !== spawnChannelId) return;

  const channelId = msg.channel.id;

  if (spawnLocks.has(channelId)) return;

  const existing = await getActiveSpawn(channelId);

  // Belum pernah ada baris channel ini sama sekali -> mulai timer,
  // JANGAN langsung spawn di pesan pertama channel itu.
  if (!existing) {
    await touchSpawnTimer(channelId);
    return;
  }

  // Ada spawn aktif yang belum diklaim.
  if (existing.anilist_id) {
    if (isTimedOut(existing.spawned_at)) {
      // Hangus karena kelamaan tidak ada yang klaim.
      await clearSpawn(channelId);
    }
    return; // selama belum hangus/diklaim, jangan spawn tumpang tindih
  }

  if (!isDueForSpawn(existing.last_spawn_at)) return;

  spawnLocks.add(channelId);

  try {
    const character = await fetchRandomCharacterWithRetry();
    if (!character) return;

    await setSpawn(channelId, character);
    await msg.channel.send({ embeds: [buildSpawnEmbed(character)] });
  } catch (error) {
    console.error("Gagal spawn karakter:", error.message);
  } finally {
    spawnLocks.delete(channelId);
  }
}