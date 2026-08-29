import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { claimActiveCharacter } from "../database.js";
import { RARITY_EMOJI } from "../anilist.js";
import { getSpawnChannelId } from "../characterSpawn.js";

export async function handleClaimCommand(msg) {
  // PENTING: spawn aktif disimpan di bawah key channel RESMI (hasil
  // `msetspawnchannel`), bukan channel tempat command diketik -- supaya
  // konsisten dengan characterSpawn.js yang sekarang melacak aktivitas
  // dari channel manapun tapi selalu spawn ke channel resmi itu.
  const spawnChannelId = await getSpawnChannelId();

  if (!spawnChannelId) {
    return msg.reply(
      "Channel spawn karakter belum diatur oleh admin (`msetspawnchannel`)."
    );
  }

  const spawn = await claimActiveCharacter(spawnChannelId, msg.author.id);

  if (!spawn) {
    return msg.reply(
      "Tidak ada karakter yang sedang muncul saat ini. Tunggu spawn berikutnya~"
    );
  }

  const emoji = RARITY_EMOJI[spawn.rarity] || "⚪";

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Claimed!`)
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