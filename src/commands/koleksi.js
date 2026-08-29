import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { BOT_NAME } from "../config.js";
import { getUserCollection } from "../database.js";
import { RARITY_EMOJI } from "../anilist.js";

const PAGE_TIMEOUT_MS = 60 * 1000; // tombol nonaktif otomatis setelah 1 menit

function buildPageEmbed(character, index, total, username) {
  const emoji = RARITY_EMOJI[character.rarity] || "⚪";

  return new EmbedBuilder()
    .setTitle(`Collection - ${username}`)
    .setDescription(
      `${emoji} **${character.name}**\n` +
        `Dari: *${character.series}*\n` +
        `Rarity: **${character.rarity}**`
    )
    .setImage(character.image_url)
    .setColor(0xffaa00)
    .setFooter({ text: `${BOT_NAME} • Karakter ${index + 1} dari ${total}` })
    .setTimestamp();
}

function buildRow(index, total, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("koleksi_prev")
      .setLabel("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === 0),
    new ButtonBuilder()
      .setCustomId("koleksi_next")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === total - 1)
  );
}

export async function handleKoleksiCommand(msg) {
  const rows = await getUserCollection(msg.author.id);

  if (!rows.length) {
    return msg.reply(
      "Koleksi kamu masih kosong. Tunggu karakter muncul lalu ketik command claim!"
    );
  }

  let index = 0;

  const sentMessage = await msg.reply({
    embeds: [buildPageEmbed(rows[index], index, rows.length, msg.author.username)],
    components: rows.length > 1 ? [buildRow(index, rows.length)] : [],
  });

  // Kalau cuma punya 1 karakter, tidak perlu tombol/collector sama sekali.
  if (rows.length <= 1) return;

  const collector = sentMessage.createMessageComponentCollector({
    time: PAGE_TIMEOUT_MS,
  });

  collector.on("collect", async (interaction) => {
    // Cuma pemilik command yang boleh geser halaman.
    if (interaction.user.id !== msg.author.id) {
      return interaction.reply({
        content: "Ini koleksi orang lain, geser punya kamu sendiri ya~",
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
      // pesan mungkin sudah dihapus, abaikan saja
    }
  });
}