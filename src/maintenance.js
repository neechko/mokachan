// ==================== MAINTENANCE OTOMATIS ====================
// Solusi otomatis buat masalah disk penuh, tanpa perlu MySQL atau
// campur tangan manual:
//
// 1. VACUUM terjadwal -- SQLite TIDAK mengecilkan file .db secara
//    otomatis walau baris-barisnya sudah dihapus (misal lewat auto-trim
//    di saveHistory). VACUUM yang benar-benar merapikan ulang file
//    dan mengembalikan ruang kosong itu ke disk.
// 2. Monitor disk space -- ngecek sisa ruang disk berkala, dan kirim
//    peringatan ke channel notifikasi kalau sudah mepet, SEBELUM
//    beneran penuh dan bikin error di tengah pemakaian.

import { statfs } from "node:fs/promises";
import { vacuumDatabase } from "./database.js";
import { NOTIFY_CHANNEL_ID, BOT_NAME } from "./config.js";

const DISK_WARNING_THRESHOLD_MB = 100; // di bawah ini dianggap "mepet"
let alreadyWarned = false; // biar tidak spam warning tiap jam kalau masih mepet terus

export { vacuumDatabase };


// Return sisa disk dalam MB, atau null kalau gagal cek (misal platform
// yang tidak support statfs).
export async function getFreeDiskMB() {
  try {
    const stats = await statfs(process.cwd());
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes / (1024 * 1024);
  } catch (error) {
    console.error("Gagal cek disk space:", error.message);
    return null;
  }
}

export async function checkDiskSpace(client) {
  const freeMB = await getFreeDiskMB();
  if (freeMB === null) return;

  if (freeMB < DISK_WARNING_THRESHOLD_MB) {
    console.warn(`Disk hampir penuh! Sisa ~${freeMB.toFixed(1)} MB.`);

    if (!alreadyWarned && NOTIFY_CHANNEL_ID) {
      alreadyWarned = true;

      try {
        const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);
        await channel?.send(
          `**${BOT_NAME}**: disk hosting sisa ~${freeMB.toFixed(
            1
          )} MB, hampir penuh. Tolong cek/bersihkan disk sebelum kehabisan total.`
        );
      } catch (error) {
        console.error("Gagal kirim peringatan disk space:", error.message);
      }
    }
  } else {
    // Sudah lega lagi -- reset flag supaya bisa warning ulang kalau
    // nanti mepet lagi di masa depan.
    alreadyWarned = false;
  }
}

// Dipanggil sekali waktu bot start, lalu berkala lewat setInterval di
// index.js. Jalanin VACUUM dulu (siapa tau langsung ngebantu ngirit
// ruang), baru cek sisa disk-nya.
export async function runMaintenance(client) {
  try {
    await vacuumDatabase();
    console.log("🧹 VACUUM selesai -- ruang kosong di database dikembalikan ke disk.");
  } catch (error) {
    console.error("⚠️ Gagal menjalankan VACUUM:", error.message);
  }

  await checkDiskSpace(client);
}
