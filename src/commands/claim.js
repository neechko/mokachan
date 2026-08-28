import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { claimActiveCharacter } from "../database.js";
import { RARITY_EMOJI } from "../anilist.js";

export async function handleClaimCommand(msg) {
  const spawn = await claimActiveCharacter(msg.channel.id, msg.author.id);

  if (!spawn) {
    return msg.reply(
      "Tidak ada karakter yang sedang muncul di channel ini. Tunggu spawn berikutnya~"
    );
  }

  const emoji = RARITY_EMOJI[spawn.rarity] || "⚪";

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Berhasil diklaim!`)
    .setDescription(
      `**${msg.author.username}** berhasil klaim **${spawn.name}**\n` +
        `Dari: *${spawn.series}*\n` +
        `Rarity: **${spawn.rarity}**`
    )
    .setImage(spawn.image_url)
    .setColor(0x00cc99)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}
