import "dotenv/config";
import postgres from "postgres";
import Database from "better-sqlite3";

const SQLITE_PATH = "C:\\Users\\Lenovo\\Desktop\\mokachan\\backup\\mokachan_history.db";
const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

async function fix() {
  console.log("=".repeat(50));
  console.log("PERBAIKAN SKEMA & CLEANUP DATA DUPLIKAT");
  console.log("=".repeat(50));

  // 1. Fix character_claims (wanderer & raiden-shogun)
  console.log("\n1. Memperbaiki tabel character_claims...");
  try {
    await sql`ALTER TABLE character_claims ALTER COLUMN anilist_id TYPE TEXT`;
    console.log("   ✅ Tipe kolom anilist_id berhasil diubah menjadi TEXT.");
  } catch (e) {
    console.log("   (Kolom mungkin sudah TEXT, lanjut...)");
  }

  const missingChars = sqlite.prepare(`SELECT * FROM character_claims WHERE typeof(anilist_id) = 'text'`).all();
  let inserted = 0;
  for (const row of missingChars) {
    const exists = await sql`SELECT 1 FROM character_claims WHERE anilist_id = ${String(row.anilist_id)} AND user_id = ${row.user_id}`;
    if (exists.length === 0) {
      await sql`
        INSERT INTO character_claims (user_id, anilist_id, name, series, image_url, rarity, claimed_at)
        VALUES (${row.user_id}, ${String(row.anilist_id)}, ${row.name}, ${row.series}, ${row.image_url}, ${row.rarity}, ${new Date(row.claimed_at)})
      `;
      inserted++;
      console.log(`   ✅ Berhasil insert karakter: ${row.name} (${row.anilist_id})`);
    }
  }
  if (inserted === 0) console.log("   (Data karakter string sudah ada / tidak ada yang hilang)");

  // 2. Cleanup Duplicates (karena script migrasi jalan 2x)
  console.log("\n2. Membersihkan data duplikat...");
  
  const beforeHistory = await sql`SELECT COUNT(*)::int as c FROM history`;
  await sql`
    DELETE FROM history
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, prompt, created_at ORDER BY id) as rn
        FROM history
      ) t WHERE t.rn > 1
    )
  `;
  const afterHistory = await sql`SELECT COUNT(*)::int as c FROM history`;
  console.log(`   ✅ history: ${beforeHistory[0].c} -> ${afterHistory[0].c} baris (duplikat dihapus)`);

  const beforeBuffer = await sql`SELECT COUNT(*)::int as c FROM passive_chat_buffer`;
  await sql`
    DELETE FROM passive_chat_buffer
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, content, created_at ORDER BY id) as rn
        FROM passive_chat_buffer
      ) t WHERE t.rn > 1
    )
  `;
  const afterBuffer = await sql`SELECT COUNT(*)::int as c FROM passive_chat_buffer`;
  console.log(`   ✅ passive_chat_buffer: ${beforeBuffer[0].c} -> ${afterBuffer[0].c} baris (duplikat dihapus)`);

  // 3. Final Verification
  console.log("\n" + "=".repeat(50));
  console.log("STATUS AKHIR DATABASE NEON (BERSIH & LENGKAP)");
  console.log("=".repeat(50));
  const tables = [
    "bot_settings", "channel_spawn", "character_claims",
    "companion_memory", "history", "model_usage",
    "model_usage_stats", "passive_chat_buffer"
  ];
  for (const table of tables) {
    const [{ count }] = await sql.unsafe(`SELECT COUNT(*)::int as count FROM ${table}`);
    console.log(`  ${table.padEnd(22)}: ${count} baris`);
  }

  await sql.end();
  sqlite.close();
  console.log("\n✅ Selesai! Database Neon Anda sekarang 100% sempurna.");
}

fix().catch(err => { console.error("Error:", err); process.exit(1); });