import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

async function init() {
  console.log("Membuat tabel tambahan di Neon...\n");

  // 1. bot_settings - untuk menyimpan config global bot
  await sql`
    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ bot_settings OK");

  // 2. channel_spawn - untuk tracking spawn karakter per channel
  await sql`
    CREATE TABLE IF NOT EXISTS channel_spawn (
      channel_id TEXT PRIMARY KEY,
      last_spawn_at TIMESTAMPTZ,
      anilist_id INTEGER,
      name TEXT,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      spawned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ channel_spawn OK");

  // 3. character_claims - koleksi karakter yang sudah di-claim user
  await sql`
    CREATE TABLE IF NOT EXISTS character_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      anilist_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      series TEXT,
      image_url TEXT,
      rarity TEXT,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_claims_user 
    ON character_claims (user_id, claimed_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_claims_anilist 
    ON character_claims (anilist_id)
  `;
  console.log("✅ character_claims OK");

  // 4. model_usage_stats - statistik penggunaan model
  await sql`
    CREATE TABLE IF NOT EXISTS model_usage_stats (
      model TEXT PRIMARY KEY,
      success_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ model_usage_stats OK");

  // 5. Drop dan recreate model_usage dengan kolom yang benar (used_at)
  await sql`DROP TABLE IF EXISTS model_usage CASCADE`;
  await sql`
    CREATE TABLE model_usage (
      id BIGSERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_model_usage_time 
    ON model_usage (used_at DESC)
  `;
  console.log("✅ model_usage OK (recreated dengan kolom used_at)");

  // 6. Drop dan recreate companion_memory dengan kolom yang sesuai SQLite
  await sql`DROP TABLE IF EXISTS companion_memory CASCADE`;
  await sql`
    CREATE TABLE companion_memory (
      user_id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL DEFAULT '',
      affection INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      facts TEXT NOT NULL DEFAULT '[]',
      last_prompt TEXT NOT NULL DEFAULT '',
      last_response TEXT NOT NULL DEFAULT '',
      turns_since_summary INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ companion_memory OK (recreated dengan kolom yang sesuai)");

  console.log("\nSemua tabel tambahan berhasil dibuat!");
  await sql.end();
}

init().catch(async (err) => {
  console.error("Gagal:", err.message);
  await sql.end();
  process.exit(1);
});