import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL belum ada di .env");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  ssl: "require",
});

async function init() {
  console.log("Membuat tabel Mokachan di Neon...");

  // Tabel companion memory (inti bot: affection, summary, facts)
  await sql`
    CREATE TABLE IF NOT EXISTS companion_memory (
      user_id TEXT PRIMARY KEY,
      affection INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      facts TEXT NOT NULL DEFAULT '[]',
      nickname TEXT NOT NULL DEFAULT '',
      last_prompt TEXT NOT NULL DEFAULT '',
      last_response TEXT NOT NULL DEFAULT '',
      turns_since_summary INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("Tabel companion_memory OK");

  // Tabel buffer chat pasif
  await sql`
    CREATE TABLE IF NOT EXISTS passive_chat_buffer (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("Tabel passive_chat_buffer OK");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_passive_buffer_user
    ON passive_chat_buffer (user_id, id)
  `;

  // Tabel history chat
  await sql`
    CREATE TABLE IF NOT EXISTS history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("Tabel history OK");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_history_user_created
    ON history (user_id, created_at DESC)
  `;

  // Tabel usage model
  await sql`
    CREATE TABLE IF NOT EXISTS model_usage (
      id BIGSERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("Tabel model_usage OK");

  // Tampilkan semua tabel yang sudah dibuat
  const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  console.log("\nSemua tabel berhasil dibuat:");
  console.table(tables);

  await sql.end();
}

init().catch(async (err) => {
  console.error("Gagal init Neon:", err.message);
  await sql.end();
  process.exit(1);
});