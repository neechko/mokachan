import { statfs } from "node:fs/promises";
import { BOT_NAME, NOTIFY_CHANNEL_ID } from "./config.js";
import { getDatabaseSizeBytes } from "./database.js";

const DISK_WARN_PERCENT =
  parseInt(process.env.DISK_WARN_PERCENT, 10) || 90;

const DISK_WARN_COOLDOWN_MS =
  parseInt(process.env.DISK_WARN_COOLDOWN_MS, 10) || 6 * 60 * 60 * 1000;

let lastDiskWarningAt = 0;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const decimals = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export async function runMaintenance(client) {
  try {
    const stats = await statfs(process.cwd());

    const blockSize = Number(stats.bsize);
    const total = Number(stats.blocks) * blockSize;
    const free = Number(stats.bfree) * blockSize;
    const used = Math.max(0, total - free);
    const usedPercent = total > 0 ? (used / total) * 100 : 0;

    console.log(
      `Disk hosting: ${usedPercent.toFixed(1)}% used ` +
        `(${formatBytes(used)} / ${formatBytes(total)})`
    );

    const now = Date.now();
    const shouldWarn =
      usedPercent >= DISK_WARN_PERCENT &&
      now - lastDiskWarningAt >= DISK_WARN_COOLDOWN_MS;

    if (shouldWarn) {
      lastDiskWarningAt = now;

      const warningText =
        `Disk hosting ${BOT_NAME} hampir penuh.\n` +
        `Terpakai: **${usedPercent.toFixed(1)}%** ` +
        `(${formatBytes(used)} / ${formatBytes(total)}).\n` +
        `Segera bersihkan file/log yang tidak diperlukan.`;

      console.warn(warningText);

      if (NOTIFY_CHANNEL_ID) {
        const channel = await client.channels
          .fetch(NOTIFY_CHANNEL_ID)
          .catch(() => null);

        if (channel?.send) {
          await channel.send(warningText).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("Disk maintenance error:", error.message);
  }

  // Opsional: ping Neon sekaligus lihat ukuran database.
  try {
    const neonBytes = await getDatabaseSizeBytes();
    console.log(`Neon database size: ${formatBytes(neonBytes)}`);
  } catch (error) {
    console.warn("Neon maintenance check failed:", error.message);
  }
}