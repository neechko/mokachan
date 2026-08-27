import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { getModelStats } from "../database.js";

function makeBar(rate) {
  const filled = Math.round(rate / 5);
  return "█".repeat(filled) + "░".repeat(20 - filled);
}

export async function handleStatsCommand(msg) {
  const rows = await getModelStats();

  if (!rows.length) {
    return msg.reply("📊 Belum ada data penggunaan Gemini.");
  }

  const description = rows
    .map(
      (row) =>
        `🤖 **${row.model}**\n` +
        `[${makeBar(row.rate)}] ` +
        `${row.rate}% ` +
        `(${row.sukses}/${row.total})`
    )
    .join("\n\n");

  const embed = new EmbedBuilder()
    .setTitle("📊 Statistik Gemini")
    .setColor(0x33cc33)
    .setDescription(description)
    .setFooter({ text: `${BOT_NAME} AI` })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}
