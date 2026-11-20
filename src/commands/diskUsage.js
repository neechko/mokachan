import { EmbedBuilder } from "discord.js";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { BOT_NAME, OWNER_ID } from "../config.js";
import { getDatabaseSizeBytes } from "../database.js";

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

function progressBar(percent, width = 12) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const filled = Math.round((safePercent / 100) * width);
  const empty = Math.max(0, width - filled);

  return "█".repeat(filled) + "░".repeat(empty);
}

async function readDiskUsage(label, dir) {
  try {
    const stats = await statfs(dir);

    const blockSize = Number(stats.bsize);
    const total = Number(stats.blocks) * blockSize;
    const free = Number(stats.bfree) * blockSize;
    const available = Number(stats.bavail) * blockSize;
    const used = Math.max(0, total - free);
    const usedPercent = total > 0 ? (used / total) * 100 : 0;

    return {
      ok: true,
      label,
      dir,
      total,
      free,
      available,
      used,
      usedPercent,
    };
  } catch (error) {
    return {
      ok: false,
      label,
      dir,
      error: error.message,
    };
  }
}

export async function handleDiskUsageCommand(msg) {
  // Kalau OWNER_ID diset, batasi command ini hanya untuk owner.
  // Kalau OWNER_ID kosong, command bisa dipakai siapa saja.
  if (OWNER_ID && msg.author.id !== OWNER_ID) {
    return msg.reply("Command ini hanya untuk owner bot.");
  }

  const targets = [
    {
      label: "Hosting / project",
      dir: process.cwd(),
    },
    {
      label: "Temp folder",
      dir: os.tmpdir(),
    },
  ];

  const disks = await Promise.all(
    targets.map((target) => readDiskUsage(target.label, target.dir))
  );

  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} — Disk Usage`)
    .setColor(0x57f287)
    .setTimestamp();

  for (const disk of disks) {
    if (!disk.ok) {
      embed.addFields({
        name: disk.label,
        value: `Tidak bisa dibaca: ${disk.error}`,
      });
      continue;
    }

    const percent = disk.usedPercent;

    embed.addFields({
      name: `${disk.label} — ${percent.toFixed(1)}% used`,
      value: [
        `Path: \`${disk.dir}\``,
        `Total: **${formatBytes(disk.total)}**`,
        `Terpakai: **${formatBytes(disk.used)}**`,
        `Tersedia: **${formatBytes(disk.available)}**`,
        `${progressBar(percent)} ${percent.toFixed(1)}%`,
      ].join("\n"),
    });
  }

  try {
    const neonBytes = await getDatabaseSizeBytes();

    embed.addFields({
      name: "Neon PostgreSQL",
      value: [
        `Ukuran database: **${formatBytes(neonBytes)}**`,
      ].join("\n"),
    });
  } catch (error) {
    embed.addFields({
      name: "Neon PostgreSQL",
      value: `Tidak bisa mengambil ukuran database: ${error.message}`,
    });
  }

  return msg.reply({ embeds: [embed] });
}