import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL belum ada di .env");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  ssl: "require",
});

try {
  const [row] = await sql`SELECT NOW() AS current_time`;
  console.log("✅ Koneksi Neon berhasil!");
  console.log("Waktu server:", row.current_time);
} catch (err) {
  console.error("❌ Gagal koneksi ke Neon:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}