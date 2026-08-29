// ==================== SPAWN KARAKTER OTOMATIS ====================
// Mirip mekanisme "Rimi-chan": selama SERVER ada yang chat (di channel
// MANAPUN), setiap CHARACTER_SPAWN_INTERVAL_MS (default 20 menit) sejak
// spawn/klaim terakhir, karakter random dari AniList otomatis muncul di
// CHANNEL RESMI yang sudah di-set admin (msetspawnchannel). Siapapun yang
// paling cepat ketik command claim akan mendapatkannya. Kalau tidak ada
// yang klaim dalam CHARACTER_SPAWN_TIMEOUT_MS, spawn hangus dan bisa
// dapat spawn baru lagi.
//
// CATATAN FIX: versi sebelumnya cuma menghitung aktivitas KALAU pesannya
// dikirim persis di channel spawn itu sendiri (`if (msg.channel.id !==
// spawnChannelId) return`) -- jadi kalau orang cuma chat di channel lain,
// timer tidak pernah jalan. Sekarang SEMUA pesan di channel manapun di
// server dihitung sebagai aktivitas, tapi karakter TETAP selalu dikirim
// ke channel resmi (bukan ke channel tempat pesan pemicu itu berasal).

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

// Guard di memori supaya 2 pesan yang datang nyaris bersamaan tidak
// sama-sama lolos cek "waktunya spawn" dan memicu 2 fetch AniList sekaligus.
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

// Diexport supaya claim.js bisa tau spawn sedang "disimpan" di bawah key
// channel resmi yang mana -- karena sekarang state spawn TIDAK lagi
// disimpan per-channel-pengirim, melainkan selalu per-channel-resmi.
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

// Dipanggil di SETIAP pesan masuk di server manapun/channel manapun
// (bukan cuma command) untuk melacak aktivitas & memicu spawn kalau
// sudah waktunya. Aktivitas dihitung dari channel manapun, tapi hasil
// spawn-nya selalu dikirim ke channel resmi.
export async function maybeSpawnCharacter(msg) {
  if (!msg.guild) return;

  const spawnChannelId = await getSpawnChannelId();

  // Belum ada channel resmi yang diatur admin -> jangan spawn di
  // channel manapun sampai di-set lewat `msetspawnchannel`.
  if (!spawnChannelId) return;

  if (spawnLocks.has(spawnChannelId)) return;

  // PENTING: state (timer, spawn aktif) selalu disimpan di bawah key
  // `spawnChannelId`, BUKAN `msg.channel.id`. Jadi chat di channel
  // manapun tetap menghidupkan timer yang sama.
  const existing = await getActiveSpawn(spawnChannelId);

  // Baris channel resmi ini belum pernah dibuat sama sekali -> mulai
  // timer, JANGAN langsung spawn di pesan pertama yang memicu ini.
  if (!existing) {
    await touchSpawnTimer(spawnChannelId);
    return;
  }

  // Ada spawn aktif yang belum diklaim.
  if (existing.anilist_id) {
    if (isTimedOut(existing.spawned_at)) {
      // Hangus karena kelamaan tidak ada yang klaim.
      await clearSpawn(spawnChannelId);
    }
    return; // selama belum hangus/diklaim, jangan spawn tumpang tindih
  }

  if (!isDueForSpawn(existing.last_spawn_at)) return;

  spawnLocks.add(spawnChannelId);

  try {
    const character = await fetchRandomCharacterWithRetry();
    if (!character) return;

    // Ambil object channel resmi secara langsung (BUKAN msg.channel),
    // karena pesan pemicu bisa datang dari channel lain sama sekali.
    const targetChannel = await msg.client.channels
      .fetch(spawnChannelId)
      .catch(() => null);

    if (!targetChannel || !targetChannel.send) {
      console.error(
        "Channel spawn resmi tidak ditemukan/tidak bisa diakses. Cek lagi hasil `msetspawnchannel`."
      );
      return;
    }

    await setSpawn(spawnChannelId, character);
    await targetChannel.send({ embeds: [buildSpawnEmbed(character)] });
  } catch (error) {
    console.error("Gagal spawn karakter:", error.message);
  } finally {
    spawnLocks.delete(spawnChannelId);
  }
}