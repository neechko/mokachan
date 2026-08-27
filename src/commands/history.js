import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { getRecentHistory } from "../database.js";

export async function handleHistoryCommand(msg) {
  const rows = await getRecentHistory(msg.author.id, 5);

  if (!rows.length) {
    return msg.reply("Tidak ada history.");
  }

  const embed = new EmbedBuilder()
    .setTitle("🕒 History Chatmu (terakhir 5)")
    .setColor(0xffaa00)
    .setFooter({ text: `${BOT_NAME}` })
    .setTimestamp();

  let description = "";

  for (const row of rows) {
    description +=
      `**Q:** ${row.prompt}\n` +
      `**A:** ${row.response}\n` +
      `*${row.created_at}*\n\n`;
  }

  embed.setDescription(description.slice(0, 4096));

  return msg.reply({ embeds: [embed] });
}
