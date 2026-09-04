import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { stat, statfs } from "node:fs/promises";
import { HISTORY_COUNT, HISTORY_RETAIN_COUNT } from "./config.js";

let db;

// Filename used for both the main long-lived connection and any
// short-lived probe connections opened to inspect on-disk state
// without disturbing the main connection's in-memory pragma flags.
const DB_FILENAME = "./mokachan_history.db";

// Require at least this many times the current .db file size in free
// disk space before attempting a full VACUUM. A full VACUUM writes an
// entire fresh copy of the database to a temp file before swapping it
// in, so anything less than the file's own size guarantees failure --
// this multiplier leaves headroom for that plus normal DB growth while
// the (potentially slow) operation runs.
const VACUUM_SAFETY_MULTIPLIER = 1.5;

export async function initDB() {
  db = await open({
    filename: DB_FILENAME,
    driver: sqlite3.Database,
  });

  // Switch to incremental auto-vacuum. Without this, SQLite never
  // returns space from deleted rows back to the OS until a full VACUUM
  // runs, and a full VACUUM needs roughly as much temp disk space as
  // the entire database file -- which can become impossible once disk
  // is already tight. Incremental mode reclaims small chunks of free
  // space continuously instead, avoiding that trap.
  //
  // Note: switching an EXISTING database into this mode still requires
  // one successful full VACUUM to take effect -- this line alone is a
  // no-op for a non-empty database until that happens. See
  // convertToIncrementalVacuum() below for the guarded, one-time way
  // to actually complete that conversion; call it manually (e.g. from
  // an admin command) when disk space is healthy, not automatically
  // here on every startup.
  await db.exec("PRAGMA auto_vacuum = INCREMENTAL");

  // Force SQLite to keep its internal scratch space (used for sorting,
  // GROUP BY, subqueries, and VACUUM's temporary copy) entirely in
  // memory instead of writing temp files to disk. This matters because
  // many container hosts mount a small, separate filesystem for temp
  // files (often /tmp, sometimes just a few dozen MB, sometimes RAM
  // backed) that is completely different from the volume the main
  // database file lives on -- so "plenty of free disk" reported by a
  // hosting panel does not guarantee SQLite's temp storage has room.
  // Our data volumes here are tiny (a personal Discord bot), so the
  // memory cost of this is negligible.
  await db.exec("PRAGMA temp_store = MEMORY");

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
    CREATE TABLE IF NOT EXISTS model_usage_stats (
      model TEXT PRIMARY KEY,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0
    )
  `);

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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS passive_chat_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      content TEXT,
      created_at TEXT
    )
  `);

  return db;
}

// ==================== SETTINGS (simple key-value) ====================

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

// ==================== HISTORY (for the AI feature) ====================

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
      console.error("Failed to fetch reply history:", error.message);
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

  // AUTO-TRIM: history is now only used for the `mhistory` command
  // (manual review), NOT the AI context source anymore (that's
  // companion_memory's job). Safe to keep only the last
  // HISTORY_RETAIN_COUNT rows PER USER -- self-cleans on every insert,
  // no separate cron/scheduler needed.
  await db.run(
    `
    DELETE FROM history
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM history WHERE user_id = ? ORDER BY id DESC LIMIT ?
    )
    `,
    userId,
    userId,
    HISTORY_RETAIN_COUNT
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

export async function getCompanionPublicInfo(userId) {
  return db.get(
    `SELECT user_id, nickname, affection, summary, facts FROM companion_memory WHERE user_id = ?`,
    userId
  );
}

// ==================== CHARACTER SPAWN (channel) ====================

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
    return null;
  }

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

export async function getUserCollection(userId, limit = 100) {
  return db.all(
    `
    SELECT id, name, series, rarity, image_url, claimed_at
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

export async function listKnownCompanionUserIds(excludeUserId, limit = 100) {
  const rows = await db.all(
    `SELECT user_id FROM companion_memory WHERE user_id != ? LIMIT ?`,
    excludeUserId,
    limit
  );
  return rows.map((r) => r.user_id);
}

// ==================== PASSIVE LEARNING (chat buffer) ====================

export async function addPassiveMessage(userId, content) {
  await db.run(
    `INSERT INTO passive_chat_buffer (user_id, content, created_at) VALUES (?, ?, ?)`,
    userId,
    content,
    new Date().toISOString()
  );
}

export async function getPassiveBuffer(userId) {
  return db.all(
    `SELECT id, content FROM passive_chat_buffer WHERE user_id = ? ORDER BY id ASC`,
    userId
  );
}

export async function getPassiveBufferCount(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM passive_chat_buffer WHERE user_id = ?`,
    userId
  );
  return row?.total || 0;
}

export async function clearPassiveBuffer(userId, uptoId = null) {
  if (uptoId) {
    await db.run(
      `DELETE FROM passive_chat_buffer WHERE user_id = ? AND id <= ?`,
      userId,
      uptoId
    );
  } else {
    await db.run(`DELETE FROM passive_chat_buffer WHERE user_id = ?`, userId);
  }
}

// ==================== VACUUM ====================

async function getFreeDiskMBFor(path) {
  const stats = await statfs(path);
  return (stats.bavail * stats.bsize) / (1024 * 1024);
}

async function getDbFileSizeMB() {
  const stats = await stat(DB_FILENAME);
  return stats.size / (1024 * 1024);
}

export async function vacuumDatabase({ force = false } = {}) {
  if (!force) {
    const [freeMB, dbSizeMB] = await Promise.all([
      getFreeDiskMBFor(process.cwd()),
      getDbFileSizeMB(),
    ]);
    const requiredMB = dbSizeMB * VACUUM_SAFETY_MULTIPLIER;

    if (freeMB < requiredMB) {
      throw new Error(
        `Refusing to VACUUM: need ~${requiredMB.toFixed(0)} MB free ` +
          `(${VACUUM_SAFETY_MULTIPLIER}x current ${dbSizeMB.toFixed(0)} MB db size) ` +
          `but only ~${freeMB.toFixed(1)} MB available. Free up disk space first.`
      );
    }
  }

  await db.exec("VACUUM");
}

async function getPersistedAutoVacuumMode() {
  const probe = await open({ filename: DB_FILENAME, driver: sqlite3.Database });
  try {
    const row = await probe.get("PRAGMA auto_vacuum");
    return row["auto_vacuum"];
  } finally {
    await probe.close();
  }
}

export async function convertToIncrementalVacuum() {
  const currentMode = await getPersistedAutoVacuumMode();
  if (currentMode === 2) {
    return { converted: false, alreadyIncremental: true };
  }

  await db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  await vacuumDatabase();

  return { converted: true, alreadyIncremental: false };
}

export async function incrementalVacuum(pageCount = 200) {
  await db.exec(`PRAGMA incremental_vacuum(${pageCount})`);
}

export async function getVacuumStatus() {
  const autoVacuum = await db.get("PRAGMA auto_vacuum");
  const freelistCount = await db.get("PRAGMA freelist_count");
  const pageCount = await db.get("PRAGMA page_count");
  const pageSize = await db.get("PRAGMA page_size");
  const persistedAutoVacuumMode = await getPersistedAutoVacuumMode();

  return {
    autoVacuumMode: autoVacuum["auto_vacuum"],
    persistedAutoVacuumMode,
    freePages: freelistCount["freelist_count"],
    totalPages: pageCount["page_count"],
    pageSizeBytes: pageSize["page_size"],
  };
}

// ==================== MODEL USAGE (for the stats feature) ====================

export async function logModelUsage(model, success) {
  await db.run(
    `
    INSERT INTO model_usage_stats (model, success_count, fail_count)
    VALUES (?, ?, ?)
    ON CONFLICT(model) DO UPDATE SET
      success_count = success_count + excluded.success_count,
      fail_count = fail_count + excluded.fail_count
    `,
    model,
    success ? 1 : 0,
    success ? 0 : 1
  );
}

export async function getModelStats() {
  return db.all(`
    SELECT
      model,
      success_count AS sukses,
      (success_count + fail_count) AS total,
      ROUND(
        (success_count * 100.0) / NULLIF(success_count + fail_count, 0),
        2
      ) AS rate
    FROM model_usage_stats
    ORDER BY rate DESC
  `);
}