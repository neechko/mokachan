// Gives a real, direct measurement of what is taking up disk space in
// the bot's working directory, instead of guessing. Useful because
// panel-reported "disk size" numbers can be misleading (e.g. showing
// allocated quota instead of actual usage), so this reads the real
// filesystem directly.

import fs from "node:fs/promises";
import path from "node:path";
import { getFreeDiskMB } from "../maintenance.js";
import { getVacuumStatus } from "../database.js";

const MAX_DEPTH = 2; // how many directory levels deep to report individually

async function measureDir(dirPath, depth = 0) {
  let total = 0;
  const items = [];
  let entries;

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { total: 0, items: [] };
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const sub = await measureDir(fullPath, depth + 1);
      total += sub.total;
      if (depth < MAX_DEPTH) {
        items.push({ name: `${entry.name}/`, size: sub.total });
      }
    } else {
      try {
        const stat = await fs.stat(fullPath);
        total += stat.size;
        if (depth < MAX_DEPTH) {
          items.push({ name: entry.name, size: stat.size });
        }
      } catch {
        // file may have been deleted mid-scan, skip it
      }
    }
  }

  return { total, items };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function handleDiskUsageCommand(msg) {
  const [{ total, items }, freeMB, vacuumStatus] = await Promise.all([
    measureDir(process.cwd()),
    getFreeDiskMB(),
    getVacuumStatus().catch(() => null),
  ]);

  const sorted = items.sort((a, b) => b.size - a.size).slice(0, 15);
  const lines = sorted.map(
    (item) => `${formatBytes(item.size).padStart(10)}  ${item.name}`
  );

  const reportLines = [
    `Working directory: ${process.cwd()}`,
    `Total size: ${formatBytes(total)}`,
    freeMB !== null ? `Free disk space (OS level): ${freeMB.toFixed(1)} MB` : "Free disk space: unavailable",
    "",
  ];

  if (vacuumStatus) {
    const dbSizeBytes = vacuumStatus.totalPages * vacuumStatus.pageSizeBytes;
    const freeSpaceBytes = vacuumStatus.freePages * vacuumStatus.pageSizeBytes;
    reportLines.push(
      `Database file: ${formatBytes(dbSizeBytes)} total, ${formatBytes(freeSpaceBytes)} reclaimable (${vacuumStatus.freePages} free pages)`,
      `auto_vacuum mode: ${vacuumStatus.autoVacuumMode === 2 ? "incremental (active)" : "not incremental -- a one-time full VACUUM is needed to enable it"}`,
      ""
    );
  }

  reportLines.push("Top items by size:", ...lines);

  await msg.reply(`\`\`\`\n${reportLines.join("\n")}\n\`\`\``);
}
