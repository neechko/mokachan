import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { BOT_NAME } from "../config.js";
import { getUserCollection } from "../database.js";
import { RARITY_LABEL } from "../anilist.js";

const PAGE_TIMEOUT_MS = 60 * 1000; // buttons disable automatically after 1 minute

function buildPageEmbed(character, index, total, username) {
  const label = RARITY_LABEL[character.rarity] || "[Common]";

  return new EmbedBuilder()
    .setTitle(`${username}'s Character Collection`)
    .setDescription(
      `**${character.name}** ${label}\n` + `From: *${character.series}*`
    )
    .setImage(character.image_url)
    .setColor(0xf1c40f)
    .setFooter({ text: `${BOT_NAME} - Character ${index + 1} of ${total}` })
    .setTimestamp();
}

function buildRow(index, total, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("koleksi_prev")
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === 0),
    new ButtonBuilder()
      .setCustomId("koleksi_next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === total - 1)
  );
}

export async function handleKoleksiCommand(msg) {
  const rows = await getUserCollection(msg.author.id);

  if (!rows.length) {
    return msg.reply(
      "Your collection is empty. Wait for a character to spawn, then use the claim command."
    );
  }

  let index = 0;

  const sentMessage = await msg.reply({
    embeds: [buildPageEmbed(rows[index], index, rows.length, msg.author.username)],
    components: rows.length > 1 ? [buildRow(index, rows.length)] : [],
  });

  // With only 1 character, no need for buttons/collector at all.
  if (rows.length <= 1) return;

  const collector = sentMessage.createMessageComponentCollector({
    time: PAGE_TIMEOUT_MS,
  });

  collector.on("collect", async (interaction) => {
    // Only the command owner can page through their own collection.
    if (interaction.user.id !== msg.author.id) {
      return interaction.reply({
        content: "This is someone else's collection -- use your own command to browse yours.",
        ephemeral: true,
      });
    }

    if (interaction.customId === "koleksi_prev" && index > 0) {
      index -= 1;
    } else if (interaction.customId === "koleksi_next" && index < rows.length - 1) {
      index += 1;
    }

    await interaction.update({
      embeds: [buildPageEmbed(rows[index], index, rows.length, msg.author.username)],
      components: [buildRow(index, rows.length)],
    });
  });

  collector.on("end", async () => {
    try {
      await sentMessage.edit({
        components: [buildRow(index, rows.length, true)],
      });
    } catch {
      // message may have been deleted, ignore
    }
  });
}