import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { getUserCollection, getUserCollectionCount } from "../database.js";
import { RARITY_EMOJI } from "../anilist.js";

export async function handleKoleksiCommand(msg) {
  const [rows, total] = await Promise.all([
    getUserCollection(msg.author.id, 10),
    getUserCollectionCount(msg.author.id),
  ]);

  if (!rows.length) {
    return msg.reply(
      "Koleksi kamu masih kosong. Tunggu karakter muncul di channel lalu ketik command claim!"
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`Koleksi Karakter ${msg.author.username}`)
    .setDescription(
      rows
        .map((row) => {
          const emoji = RARITY_EMOJI[row.rarity] || "⚪";
          return `${emoji} **${row.name}** — *${row.series}* (${row.rarity})`;
        })
        .join("\n")
    )
    .setColor(0xffaa00)
    .setFooter({ text: `${BOT_NAME} • Total dimiliki: ${total}` })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}
