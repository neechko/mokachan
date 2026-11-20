import postgres from "postgres";
import { HISTORY_COUNT, HISTORY_RETAIN_COUNT } from "./config.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set in .env. Add your Neon PostgreSQL connection string."
  );
}

// Neon pooler/transaction mode is safer with prepare: false.
const sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
  prepare: false,
  ssl: "require",

  // Hide harmless PostgreSQL NOTICE messages unless DEBUG_MODE=true.
  onnotice: (notice) => {
    if (process.env.DEBUG_MODE === "true") {
      console.log("[PG NOTICE]", notice.message);
    }
  },
});

// Old SQLite stored timestamps as ISO TEXT.
// PostgreSQL returns Date objects, so normalize them to ISO strings
// for compatibility with older code.
function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Old SQLite anilist_id could be numeric, but also custom strings
// like "wanderer" / "raiden-shogun". Neon stores it as TEXT.
// For compatibility, numeric strings are returned as numbers.
function normalizeAnilistId(value) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return /^\d+$/.test(str) ? Number(str) : str;
}

function mapSpawn(row) {
  if (!row) return row;
  return {
    ...row,
    anilist_id: normalizeAnilistId(row.anilist_id),
    last_spawn_at: iso(row.last_spawn_at),
    spawned_at: iso(row.spawned_at),
  };
}

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      prompt TEXT,
      response TEXT,
      created_at TIMESTAMPTZ,
      model TEXT
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_history_user_id_id
    ON history (user_id, id DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS model_usage_stats (
      model TEXT PRIMARY KEY,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS companion_memory (
      user_id TEXT PRIMARY KEY,
      nickname TEXT DEFAULT '',
      affection INTEGER DEFAULT 0,

      relationship_xp INTEGER NOT NULL DEFAULT 0,
      trust INTEGER NOT NULL DEFAULT 0,
      comfort INTEGER NOT NULL DEFAULT 0,
      familiarity INTEGER NOT NULL DEFAULT 0,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      last_interaction_at TIMESTAMPTZ,
      xp_day INTEGER NOT NULL DEFAULT 0,
      xp_day_date TEXT NOT NULL DEFAULT '',

      summary TEXT DEFAULT '',
      facts TEXT DEFAULT '[]',
      last_prompt TEXT DEFAULT '',
      last_response TEXT DEFAULT '',
      turns_since_summary INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS channel_spawn (
      channel_id TEXT PRIMARY KEY,
      last_spawn_at TIMESTAMPTZ,
      anilist_id TEXT,
      name TEXT,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      spawned_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS character_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      anilist_id TEXT,
      name TEXT,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      claimed_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_character_claims_user_id_id
    ON character_claims (user_id, id DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS passive_chat_buffer (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      content TEXT,
      created_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_passive_chat_buffer_user_id_id
    ON passive_chat_buffer (user_id, id ASC)
  `;

  // Legacy compatibility:
  // - anilist_id used to be INTEGER, but custom string IDs exist.
  // - bot_settings.value could be null in SQLite.
  await sql`ALTER TABLE character_claims ALTER COLUMN anilist_id TYPE TEXT`;
  await sql`ALTER TABLE character_claims ALTER COLUMN anilist_id DROP NOT NULL`;
  await sql`ALTER TABLE channel_spawn ALTER COLUMN anilist_id TYPE TEXT`;
  await sql`ALTER TABLE bot_settings ALTER COLUMN value DROP NOT NULL`;

  // Relationship XP columns for existing databases.
  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS relationship_xp INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS trust INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS comfort INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS familiarity INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS interaction_count INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS xp_day INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS xp_day_date TEXT NOT NULL DEFAULT ''
  `;

  return sql;
}

// ==================== SETTINGS (simple key-value) ====================

export async function getSetting(key) {
  const rows = await sql`
    SELECT value FROM bot_settings WHERE key = ${key}
  `;
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await sql`
    INSERT INTO bot_settings (key, value)
    VALUES (${key}, ${value ?? null})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
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
        const rows = await sql`
          SELECT prompt, response, model
          FROM history
          WHERE response = ${repliedMsg.content}
          LIMIT 1
        `;

        if (rows[0]) {
          extraHistory.push(rows[0]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch reply history:", error.message);
    }
  }

  const historyRows = await sql`
    SELECT prompt, response, model
    FROM history
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${HISTORY_COUNT}
  `;

  return [...historyRows.reverse(), ...extraHistory];
}

export async function saveHistory(userId, prompt, result, model) {
  if (result.length > 10000) return;

  await sql`
    INSERT INTO history (user_id, prompt, response, created_at, model)
    VALUES (${userId}, ${prompt}, ${result}, ${new Date()}, ${model})
  `;

  // Auto-trim per user, same behavior as the old SQLite version.
  await sql`
    DELETE FROM history
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM history
        WHERE user_id = ${userId}
        ORDER BY id DESC
        LIMIT ${HISTORY_RETAIN_COUNT}
      )
  `;
}

export async function getRecentHistory(userId, limit = 5) {
  const rows = await sql`
    SELECT prompt, response, created_at
    FROM history
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    created_at: iso(row.created_at),
  }));
}

export async function clearHistory(userId) {
  await sql`DELETE FROM history WHERE user_id = ${userId}`;
}

// ==================== COMPANION MEMORY ====================

const DEFAULT_COMPANION = {
  nickname: "",
  affection: 0,

  relationship_xp: 0,
  trust: 0,
  comfort: 0,
  familiarity: 0,
  interaction_count: 0,
  last_interaction_at: null,
  xp_day: 0,
  xp_day_date: "",

  summary: "",
  facts: "[]",
  last_prompt: "",
  last_response: "",
  turns_since_summary: 0,
};

export async function getOrCreateCompanion(userId) {
  const rows = await sql`
    SELECT * FROM companion_memory WHERE user_id = ${userId}
  `;

  if (rows[0]) {
    return {
      ...rows[0],
      updated_at: iso(rows[0].updated_at),
      last_interaction_at: iso(rows[0].last_interaction_at),
    };
  }

  await sql`
    INSERT INTO companion_memory (
      user_id,
      nickname,
      affection,
      relationship_xp,
      trust,
      comfort,
      familiarity,
      interaction_count,
      last_interaction_at,
      xp_day,
      xp_day_date,
      summary,
      facts,
      last_prompt,
      last_response,
      turns_since_summary,
      updated_at
    )
    VALUES (
      ${userId},
      ${DEFAULT_COMPANION.nickname},
      ${DEFAULT_COMPANION.affection},
      ${DEFAULT_COMPANION.relationship_xp},
      ${DEFAULT_COMPANION.trust},
      ${DEFAULT_COMPANION.comfort},
      ${DEFAULT_COMPANION.familiarity},
      ${DEFAULT_COMPANION.interaction_count},
      ${DEFAULT_COMPANION.last_interaction_at},
      ${DEFAULT_COMPANION.xp_day},
      ${DEFAULT_COMPANION.xp_day_date},
      ${DEFAULT_COMPANION.summary},
      ${DEFAULT_COMPANION.facts},
      ${DEFAULT_COMPANION.last_prompt},
      ${DEFAULT_COMPANION.last_response},
      ${DEFAULT_COMPANION.turns_since_summary},
      ${new Date()}
    )
  `;

  return { user_id: userId, ...DEFAULT_COMPANION };
}

export async function saveCompanion(userId, patch) {
  const current = await getOrCreateCompanion(userId);
  const merged = { ...current, ...patch };

  await sql`
    UPDATE companion_memory SET
      nickname = ${merged.nickname},
      affection = ${merged.affection},
      relationship_xp = ${merged.relationship_xp},
      trust = ${merged.trust},
      comfort = ${merged.comfort},
      familiarity = ${merged.familiarity},
      interaction_count = ${merged.interaction_count},
      last_interaction_at = ${merged.last_interaction_at},
      xp_day = ${merged.xp_day},
      xp_day_date = ${merged.xp_day_date},
      summary = ${merged.summary},
      facts = ${merged.facts},
      last_prompt = ${merged.last_prompt},
      last_response = ${merged.last_response},
      turns_since_summary = ${merged.turns_since_summary},
      updated_at = ${new Date()}
    WHERE user_id = ${userId}
  `;
}

export async function resetCompanion(userId) {
  await sql`DELETE FROM companion_memory WHERE user_id = ${userId}`;
}

export async function getCompanionPublicInfo(userId) {
  const rows = await sql`
    SELECT
      user_id,
      nickname,
      affection,
      relationship_xp,
      trust,
      comfort,
      familiarity,
      summary,
      facts
    FROM companion_memory
    WHERE user_id = ${userId}
  `;

  return rows[0];
}

// ==================== CHARACTER SPAWN (channel) ====================

export async function getActiveSpawn(channelId) {
  const rows = await sql`
    SELECT * FROM channel_spawn WHERE channel_id = ${channelId}
  `;

  return mapSpawn(rows[0]);
}

export async function setSpawn(channelId, character) {
  const now = new Date();
  const anilistId =
    character.anilistId === null || character.anilistId === undefined
      ? null
      : String(character.anilistId);

  await sql`
    INSERT INTO channel_spawn (
      channel_id, last_spawn_at, anilist_id, name, series,
      image_url, rarity, spawned_at
    )
    VALUES (
      ${channelId}, ${now}, ${anilistId}, ${character.name}, ${character.series},
      ${character.image}, ${character.rarity}, ${now}
    )
    ON CONFLICT (channel_id) DO UPDATE SET
      last_spawn_at = EXCLUDED.last_spawn_at,
      anilist_id = EXCLUDED.anilist_id,
      name = EXCLUDED.name,
      series = EXCLUDED.series,
      image_url = EXCLUDED.image_url,
      rarity = EXCLUDED.rarity,
      spawned_at = EXCLUDED.spawned_at
  `;
}

export async function touchSpawnTimer(channelId) {
  await sql`
    INSERT INTO channel_spawn (channel_id, last_spawn_at)
    VALUES (${channelId}, ${new Date()})
    ON CONFLICT (channel_id) DO NOTHING
  `;
}

export async function clearSpawn(channelId) {
  await sql`
    UPDATE channel_spawn
    SET anilist_id = NULL, name = NULL, series = NULL,
        image_url = NULL, rarity = NULL
    WHERE channel_id = ${channelId}
  `;
}

export async function claimActiveCharacter(channelId, userId) {
  const spawn = await getActiveSpawn(channelId);

  if (!spawn || !spawn.anilist_id) {
    return null;
  }

  await clearSpawn(channelId);

  await sql`
    INSERT INTO character_claims (
      user_id, anilist_id, name, series, image_url, rarity, claimed_at
    )
    VALUES (
      ${userId},
      ${String(spawn.anilist_id)},
      ${spawn.name},
      ${spawn.series},
      ${spawn.image_url},
      ${spawn.rarity},
      ${new Date()}
    )
  `;

  return spawn;
}

export async function getUserCollection(userId, limit = 100) {
  const rows = await sql`
    SELECT id, name, series, rarity, image_url, claimed_at
    FROM character_claims
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    id: toNumber(row.id),
    claimed_at: iso(row.claimed_at),
  }));
}

export async function getUserCollectionCount(userId) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM character_claims
    WHERE user_id = ${userId}
  `;

  return rows[0]?.total || 0;
}

export async function grantCharacterDirectly(userId, character) {
  const anilistId =
    character.anilistId === null || character.anilistId === undefined
      ? null
      : String(character.anilistId);

  await sql`
    INSERT INTO character_claims (
      user_id, anilist_id, name, series, image_url, rarity, claimed_at
    )
    VALUES (
      ${userId},
      ${anilistId},
      ${character.name},
      ${character.series},
      ${character.image},
      ${character.rarity},
      ${new Date()}
    )
  `;
}

export async function listKnownCompanionUserIds(excludeUserId, limit = 100) {
  const rows = await sql`
    SELECT user_id
    FROM companion_memory
    WHERE user_id != ${excludeUserId}
    LIMIT ${limit}
  `;

  return rows.map((r) => r.user_id);
}

// ==================== PASSIVE LEARNING (chat buffer) ====================

export async function addPassiveMessage(userId, content) {
  await sql`
    INSERT INTO passive_chat_buffer (user_id, content, created_at)
    VALUES (${userId}, ${content}, ${new Date()})
  `;
}

export async function getPassiveBuffer(userId) {
  const rows = await sql`
    SELECT id, content
    FROM passive_chat_buffer
    WHERE user_id = ${userId}
    ORDER BY id ASC
  `;

  return rows.map((row) => ({
    ...row,
    id: toNumber(row.id),
  }));
}

export async function getPassiveBufferCount(userId) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM passive_chat_buffer
    WHERE user_id = ${userId}
  `;

  return rows[0]?.total || 0;
}

export async function clearPassiveBuffer(userId, uptoId = null) {
  if (uptoId) {
    await sql`
      DELETE FROM passive_chat_buffer
      WHERE user_id = ${userId} AND id <= ${uptoId}
    `;
  } else {
    await sql`
      DELETE FROM passive_chat_buffer
      WHERE user_id = ${userId}
    `;
  }
}

// ==================== VACUUM / STORAGE COMPATIBILITY ====================
// PostgreSQL/Neon does not use SQLite VACUUM/incremental vacuum.
// These functions remain exported so older commands do not crash.

export async function vacuumDatabase({ force = false } = {}) {
  try {
    await sql`VACUUM (ANALYZE)`;
    return {
      ok: true,
      engine: "postgres",
      forced: force,
    };
  } catch (error) {
    // Some managed Postgres providers restrict manual VACUUM.
    // Autovacuum still runs on the provider side.
    return {
      ok: false,
      skipped: true,
      engine: "postgres",
      reason: error.message,
    };
  }
}

export async function convertToIncrementalVacuum() {
  return {
    converted: false,
    alreadyIncremental: true,
    engine: "postgres",
    note: "Neon/PostgreSQL uses autovacuum, not SQLite incremental vacuum.",
  };
}

export async function incrementalVacuum(pageCount = 200) {
  return {
    skipped: true,
    engine: "postgres",
    requestedPages: pageCount,
  };
}

export async function getVacuumStatus() {
  const stats = await sql`
    SELECT
      COALESCE(SUM(n_dead_tup), 0)::bigint AS dead_tuples,
      COALESCE(SUM(n_live_tup), 0)::bigint AS live_tuples
    FROM pg_stat_user_tables
  `;

  const size = await sql`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `;

  return {
    engine: "postgres",
    autoVacuumMode: "automatic",
    persistedAutoVacuumMode: "automatic",
    freePages: 0,
    totalPages: 0,
    pageSizeBytes: 8192,
    deadTuples: toNumber(stats[0]?.dead_tuples),
    liveTuples: toNumber(stats[0]?.live_tuples),
    databaseSizeBytes: toNumber(size[0]?.bytes),
  };
}

// ==================== MODEL USAGE (for the stats feature) ====================

export async function logModelUsage(model, success) {
  await sql`
    INSERT INTO model_usage_stats (model, success_count, fail_count)
    VALUES (${model}, ${success ? 1 : 0}, ${success ? 0 : 1})
    ON CONFLICT (model) DO UPDATE SET
      success_count = model_usage_stats.success_count + EXCLUDED.success_count,
      fail_count = model_usage_stats.fail_count + EXCLUDED.fail_count
  `;
}

export async function getModelStats() {
  const rows = await sql`
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
  `;

  return rows.map((row) => ({
    ...row,
    sukses: toNumber(row.sukses),
    total: toNumber(row.total),
    rate: row.rate === null ? null : toNumber(row.rate),
  }));
}

export async function getDatabaseSizeBytes() {
  const rows = await sql`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `;

  return Number(rows[0]?.bytes ?? 0);
}

// Optional: for graceful shutdown in index.js
export async function closeDB() {
  await sql.end();
}