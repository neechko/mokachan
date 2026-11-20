import "dotenv/config";
import postgres from "postgres";
import Database from "better-sqlite3";
import fs from "fs";

// ====== KONFIGURASI ======
const SQLITE_PATH = process.argv[2] || "./mokachan_history.db";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL belum ada di .env");
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`File tidak ditemukan: ${SQLITE_PATH}`);
  process.exit(1);
}

console.log("=".repeat(60));
console.log("MIGRASI LENGKAP: SQLite -> Neon PostgreSQL");
console.log("=".repeat(60));
console.log(`SQLite: ${SQLITE_PATH}`);
console.log(`Target: Neon\n`);

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(DATABASE_URL, { max: 5, ssl: "require" });

// ====== MIGRATION FUNCTIONS ======

async function migrateSimple(tableName, columns) {
  const rows = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
  if (rows.length === 0) {
    console.log(`  ${tableName}: kosong, skip`);
    return;
  }

  console.log(`  ${tableName}: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      const values = columns.map(col => row[col] ?? null);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const query = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      await sql.unsafe(query, values);
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateCompanionMemory() {
  const rows = sqlite.prepare(`SELECT * FROM companion_memory`).all();
  console.log(`  companion_memory: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO companion_memory 
          (user_id, nickname, affection, summary, facts, last_prompt, last_response, turns_since_summary, updated_at)
        VALUES 
          (${row.user_id}, ${row.nickname || ''}, ${row.affection || 0}, ${row.summary || ''}, 
           ${row.facts || '[]'}, ${row.last_prompt || ''}, ${row.last_response || ''}, 
           ${row.turns_since_summary || 0}, ${row.updated_at ? new Date(row.updated_at) : new Date()})
        ON CONFLICT (user_id) DO UPDATE SET
          nickname = EXCLUDED.nickname,
          affection = EXCLUDED.affection,
          summary = EXCLUDED.summary,
          facts = EXCLUDED.facts,
          last_prompt = EXCLUDED.last_prompt,
          last_response = EXCLUDED.last_response,
          turns_since_summary = EXCLUDED.turns_since_summary,
          updated_at = EXCLUDED.updated_at
      `;
      success++;
    } catch (err) {
      console.error(`    Error user ${row.user_id}: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateHistory() {
  const rows = sqlite.prepare(`SELECT * FROM history`).all();
  console.log(`  history: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO history (user_id, prompt, response, model, created_at)
        VALUES (${row.user_id}, ${row.prompt}, ${row.response}, ${row.model || null}, 
                ${row.created_at ? new Date(row.created_at) : new Date()})
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateModelUsage() {
  const rows = sqlite.prepare(`SELECT * FROM model_usage`).all();
  console.log(`  model_usage: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO model_usage (model, success, used_at)
        VALUES (${row.model}, ${row.success === 1 || row.success === true}, 
                ${row.used_at ? new Date(row.used_at) : new Date()})
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migratePassiveBuffer() {
  const rows = sqlite.prepare(`SELECT * FROM passive_chat_buffer`).all();
  console.log(`  passive_chat_buffer: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO passive_chat_buffer (user_id, content, created_at)
        VALUES (${row.user_id}, ${row.content}, ${row.created_at ? new Date(row.created_at) : new Date()})
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateChannelSpawn() {
  const rows = sqlite.prepare(`SELECT * FROM channel_spawn`).all();
  console.log(`  channel_spawn: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO channel_spawn 
          (channel_id, last_spawn_at, anilist_id, name, series, image_url, rarity, spawned_at)
        VALUES 
          (${row.channel_id}, 
           ${row.last_spawn_at ? new Date(row.last_spawn_at) : null},
           ${row.anilist_id}, ${row.name}, ${row.series}, ${row.image_url}, ${row.rarity},
           ${row.spawned_at ? new Date(row.spawned_at) : new Date()})
        ON CONFLICT (channel_id) DO UPDATE SET
          last_spawn_at = EXCLUDED.last_spawn_at,
          anilist_id = EXCLUDED.anilist_id,
          name = EXCLUDED.name,
          series = EXCLUDED.series,
          image_url = EXCLUDED.image_url,
          rarity = EXCLUDED.rarity,
          spawned_at = EXCLUDED.spawned_at
      `;
      success++;
    } catch (err) {
      console.error(`    Error channel ${row.channel_id}: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateCharacterClaims() {
  const rows = sqlite.prepare(`SELECT * FROM character_claims ORDER BY id`).all();
  console.log(`  character_claims: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO character_claims 
          (user_id, anilist_id, name, series, image_url, rarity, claimed_at)
        VALUES 
          (${row.user_id}, ${row.anilist_id}, ${row.name}, ${row.series}, 
           ${row.image_url}, ${row.rarity}, 
           ${row.claimed_at ? new Date(row.claimed_at) : new Date()})
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateModelUsageStats() {
  const rows = sqlite.prepare(`SELECT * FROM model_usage_stats`).all();
  console.log(`  model_usage_stats: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO model_usage_stats (model, success_count, fail_count)
        VALUES (${row.model}, ${row.success_count || 0}, ${row.fail_count || 0})
        ON CONFLICT (model) DO UPDATE SET
          success_count = EXCLUDED.success_count,
          fail_count = EXCLUDED.fail_count,
          updated_at = NOW()
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

async function migrateBotSettings() {
  const rows = sqlite.prepare(`SELECT * FROM bot_settings`).all();
  console.log(`  bot_settings: ${rows.length} baris...`);

  let success = 0;
  for (const row of rows) {
    try {
      await sql`
        INSERT INTO bot_settings (key, value)
        VALUES (${row.key}, ${row.value})
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `;
      success++;
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`    ✅ ${success}/${rows.length} berhasil`);
}

// ====== MAIN ======
async function main() {
  try {
    console.log("Mulai migrasi...\n");

    // Urutan migrasi
    await migrateBotSettings();
    await migrateChannelSpawn();
    await migrateCharacterClaims();
    await migrateCompanionMemory();
    await migrateHistory();
    await migrateModelUsage();
    await migrateModelUsageStats();
    await migratePassiveBuffer();

    // Verifikasi
    console.log("\n" + "=".repeat(60));
    console.log("VERIFIKASI DATA DI NEON");
    console.log("=".repeat(60));

    const tables = [
      "bot_settings", "channel_spawn", "character_claims",
      "companion_memory", "history", "model_usage",
      "model_usage_stats", "passive_chat_buffer"
    ];

    for (const table of tables) {
      const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int as count FROM ${table}`);
      console.log(`  ${table}: ${count} baris`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ MIGRASI SELESAI!");
    console.log("=".repeat(60));

    await sql.end();
    sqlite.close();
  } catch (err) {
    console.error("\nMigrasi gagal:", err);
    await sql.end();
    sqlite.close();
    process.exit(1);
  }
}

main();