import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { HISTORY_COUNT } from "./config.js";

let db;

export async function initDB() {
  db = await open({
    filename: "./mokachan_history.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      prompt TEXT,
      response TEXT,
      created_at TEXT,
      model TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT,
      success INTEGER,
      used_at TEXT
    )
  `);

  // ---- companion memory: ringkasan + fakta, menggantikan history mentah ----
  await db.exec(`
    CREATE TABLE IF NOT EXISTS companion_memory (
      user_id TEXT PRIMARY KEY,
      nickname TEXT DEFAULT '',
      affection INTEGER DEFAULT 0,
      summary TEXT DEFAULT '',
      facts TEXT DEFAULT '[]',
      last_prompt TEXT DEFAULT '',
      last_response TEXT DEFAULT '',
      turns_since_summary INTEGER DEFAULT 0,
      updated_at TEXT
    )
  `);

  // ---- spawn karakter aktif per channel ----
  await db.exec(`
    CREATE TABLE IF NOT EXISTS channel_spawn (
      channel_id TEXT PRIMARY KEY,
      last_spawn_at TEXT,
      anilist_id INTEGER,
      name TEXT,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      spawned_at TEXT
    )
  `);

  // ---- koleksi karakter yang sudah diklaim user ----
  await db.exec(`
    CREATE TABLE IF NOT EXISTS character_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      anilist_id INTEGER,
      name TEXT,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      claimed_at TEXT
    )
  `);

  // ---- pengaturan bot (misal: channel khusus spawn karakter) ----
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  return db;
}

// ==================== SETTINGS (key-value sederhana) ====================

export async function getSetting(key) {
  const row = await db.get(`SELECT value FROM bot_settings WHERE key = ?`, key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  await db.run(
    `
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    key,
    value
  );
}


// ==================== HISTORY (untuk fitur AI) ====================

export async function getRelevantHistory(client, notifyChannelId, userId, replyMsgId) {
  const extraHistory = [];

  if (replyMsgId) {
    try {
      const repliedMsg = await client.channels.cache
        .get(notifyChannelId)
        ?.messages.fetch(replyMsgId);

      if (repliedMsg && repliedMsg.author.id === client.user.id) {
        const row = await db.get(
          `
          SELECT prompt, response, model
          FROM history
          WHERE response = ?
          LIMIT 1
          `,
          repliedMsg.content
        );

        if (row) {
          extraHistory.push(row);
        }
      }
    } catch (error) {
      console.error("⚠️ Gagal mengambil reply history:", error.message);
    }
  }

  const historyRows = await db.all(
    `
    SELECT prompt, response, model
    FROM history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    userId,
    HISTORY_COUNT
  );

  return [...historyRows.reverse(), ...extraHistory];
}

export async function saveHistory(userId, prompt, result, model) {
  if (result.length > 10000) return;

  await db.run(
    `
    INSERT INTO history
    (user_id, prompt, response, created_at, model)
    VALUES (?, ?, ?, ?, ?)
    `,
    userId,
    prompt,
    result,
    new Date().toISOString(),
    model
  );
}

export async function getRecentHistory(userId, limit = 5) {
  return db.all(
    `
    SELECT prompt, response, created_at
    FROM history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    userId,
    limit
  );
}

export async function clearHistory(userId) {
  await db.run("DELETE FROM history WHERE user_id = ?", userId);
}

// ==================== COMPANION MEMORY ====================
// Sumber konteks utama untuk `mokachan` sekarang. Menggantikan
// getRelevantHistory() yang lama (5 pasang Q&A mentah tiap request).

const DEFAULT_COMPANION = {
  nickname: "",
  affection: 0,
  summary: "",
  facts: "[]",
  last_prompt: "",
  last_response: "",
  turns_since_summary: 0,
};

export async function getOrCreateCompanion(userId) {
  const row = await db.get(
    `SELECT * FROM companion_memory WHERE user_id = ?`,
    userId
  );

  if (row) return row;

  await db.run(
    `
    INSERT INTO companion_memory
    (user_id, nickname, affection, summary, facts, last_prompt, last_response, turns_since_summary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    userId,
    DEFAULT_COMPANION.nickname,
    DEFAULT_COMPANION.affection,
    DEFAULT_COMPANION.summary,
    DEFAULT_COMPANION.facts,
    DEFAULT_COMPANION.last_prompt,
    DEFAULT_COMPANION.last_response,
    DEFAULT_COMPANION.turns_since_summary,
    new Date().toISOString()
  );

  return { user_id: userId, ...DEFAULT_COMPANION };
}

export async function saveCompanion(userId, patch) {
  const current = await getOrCreateCompanion(userId);
  const merged = { ...current, ...patch };

  await db.run(
    `
    UPDATE companion_memory SET
      nickname = ?,
      affection = ?,
      summary = ?,
      facts = ?,
      last_prompt = ?,
      last_response = ?,
      turns_since_summary = ?,
      updated_at = ?
    WHERE user_id = ?
    `,
    merged.nickname,
    merged.affection,
    merged.summary,
    merged.facts,
    merged.last_prompt,
    merged.last_response,
    merged.turns_since_summary,
    new Date().toISOString(),
    userId
  );
}

export async function resetCompanion(userId) {
  await db.run(`DELETE FROM companion_memory WHERE user_id = ?`, userId);
}

// ==================== SPAWN KARAKTER (channel) ====================

export async function getActiveSpawn(channelId) {
  return db.get(
    `SELECT * FROM channel_spawn WHERE channel_id = ?`,
    channelId
  );
}

export async function setSpawn(channelId, character) {
  const now = new Date().toISOString();

  await db.run(
    `
    INSERT INTO channel_spawn
      (channel_id, last_spawn_at, anilist_id, name, series, image_url, rarity, spawned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      last_spawn_at = excluded.last_spawn_at,
      anilist_id = excluded.anilist_id,
      name = excluded.name,
      series = excluded.series,
      image_url = excluded.image_url,
      rarity = excluded.rarity,
      spawned_at = excluded.spawned_at
    `,
    channelId,
    now,
    character.anilistId,
    character.name,
    character.series,
    character.image,
    character.rarity,
    now
  );
}

// Menandai channel baru saja "dicek" tanpa spawn baru (dipakai untuk
// inisialisasi timer 20 menit pertama kali channel itu ramai chat).
export async function touchSpawnTimer(channelId) {
  await db.run(
    `
    INSERT INTO channel_spawn (channel_id, last_spawn_at)
    VALUES (?, ?)
    ON CONFLICT(channel_id) DO NOTHING
    `,
    channelId,
    new Date().toISOString()
  );
}

// Hapus spawn aktif (setelah diklaim atau expired karena timeout).
export async function clearSpawn(channelId) {
  await db.run(
    `
    UPDATE channel_spawn
    SET anilist_id = NULL, name = NULL, series = NULL,
        image_url = NULL, rarity = NULL
    WHERE channel_id = ?
    `,
    channelId
  );
}

export async function claimActiveCharacter(channelId, userId) {
  const spawn = await getActiveSpawn(channelId);

  if (!spawn || !spawn.anilist_id) {
    return null; // tidak ada spawn aktif
  }

  // Hapus dulu SEBELUM insert klaim supaya kalau 2 orang ngetik nyaris
  // bersamaan, hanya yang pertama yang berhasil (karena UPDATE ini
  // membuat spawn berikutnya sudah NULL saat proses kedua jalan).
  await clearSpawn(channelId);

  await db.run(
    `
    INSERT INTO character_claims
    (user_id, anilist_id, name, series, image_url, rarity, claimed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    userId,
    spawn.anilist_id,
    spawn.name,
    spawn.series,
    spawn.image_url,
    spawn.rarity,
    new Date().toISOString()
  );

  return spawn;
}

export async function getUserCollection(userId, limit = 10) {
  return db.all(
    `
    SELECT name, series, rarity, claimed_at
    FROM character_claims
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    userId,
    limit
  );
}

export async function getUserCollectionCount(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM character_claims WHERE user_id = ?`,
    userId
  );
  return row?.total || 0;
}

// ==================== MODEL USAGE (untuk fitur stats) ====================

export async function logModelUsage(model, success) {
  await db.run(
    `
    INSERT INTO model_usage
    (model, success, used_at)
    VALUES (?, ?, ?)
    `,
    model,
    success ? 1 : 0,
    new Date().toISOString()
  );
}

export async function getModelStats() {
  return db.all(`
    SELECT
      model,
      SUM(success) AS sukses,
      COUNT(*) AS total,
      ROUND(
        (SUM(success) * 100.0) / COUNT(*),
        2
      ) AS rate
    FROM model_usage
    GROUP BY model
    ORDER BY rate DESC
  `);
}