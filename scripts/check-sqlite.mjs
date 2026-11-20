import Database from "better-sqlite3";
import fs from "fs";

const SQLITE_PATH = process.argv[2] || "./mokachan_history.db";

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`File tidak ditemukan: ${SQLITE_PATH}`);
  console.error("Gunakan: node scripts/check-sqlite.mjs path/ke/file.db");
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });

console.log("=".repeat(60));
console.log(`DATABASE: ${SQLITE_PATH}`);
console.log("=".repeat(60));

// Ambil semua tabel
const tables = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();

console.log(`\nDitemukan ${tables.length} tabel:\n`);

let totalRows = 0;

for (const { name } of tables) {
  const result = sqlite.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get();
  const count = result.count;
  totalRows += count;
  
  // Ambil kolom-kolom tabel
  const columns = sqlite.prepare(`PRAGMA table_info("${name}")`).all();
  const colNames = columns.map(c => c.name).join(", ");
  
  console.log(`📋 ${name}`);
  console.log(`   Baris: ${count}`);
  console.log(`   Kolom: ${colNames}`);
  console.log("");
}

console.log("=".repeat(60));
console.log(`TOTAL: ${tables.length} tabel, ${totalRows} baris data`);
console.log("=".repeat(60));

// Tampilkan 3 baris pertama dari setiap tabel sebagai sample
console.log("\nSAMPLE DATA (3 baris pertama per tabel):\n");

for (const { name } of tables) {
  const result = sqlite.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get();
  const count = result.count;
  if (count === 0) continue;
  
  const sample = sqlite.prepare(`SELECT * FROM "${name}" LIMIT 3`).all();
  console.log(`--- ${name} ---`);
  console.table(sample);
  console.log("");
}

sqlite.close();