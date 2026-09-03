import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { claimActiveCharacter } from "../database.js";
import { RARITY_LABEL } from "../anilist.js";
import { getSpawnChannelId } from "../characterSpawn.js";

export async function handleClaimCommand(msg) {
  // IMPORTANT: the active spawn is stored under the OFFICIAL channel
  // key (set via `msetspawnchannel`), not the channel the command was
  // typed in -- consistent with characterSpawn.js, which now tracks
  // activity from any channel but always spawns into the official one.
  const spawnChannelId = await getSpawnChannelId();

  if (!spawnChannelId) {
    return msg.reply(
      "No spawn channel has been configured yet (`msetspawnchannel`)."
    );
  }

  const spawn = await claimActiveCharacter(spawnChannelId, msg.author.id);

  if (!spawn) {
    return msg.reply(
      "No character is currently active. Wait for the next spawn."
    );
  }

  const label = RARITY_LABEL[spawn.rarity] || "[Common]";

  const embed = new EmbedBuilder()
    .setTitle("Claimed!")
    .setDescription(
      `**${msg.author.username}** claimed **${spawn.name}** ${label}\n` +
        `From: *${spawn.series}*`
    )
    .setImage(spawn.image_url)
    .setColor(0x2ecc71)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}