import discordjs from "discord.js";
const { EmbedBuilder } = discordjs;
import { BOT_NAME } from "../config.js";
import {
  getCompanionProfile,
  getCompanionPublicProfile,
} from "../companion.js";

// `mprofil` -> lihat profilmu sendiri (otomatis dibuat kalau belum ada).
// `mprofil @member` -> lihat apa yang mokachan inget soal member lain
// (read-only, tidak bikin baris baru), biar antar member bisa saling
// kenal lewat bot.
export async function handleProfilCommand(msg) {
  const targetUser = msg.mentions.users.first() || msg.author;
  const isSelf = targetUser.id === msg.author.id;

  const profile = isSelf
    ? await getCompanionProfile(targetUser.id)
    : await getCompanionPublicProfile(targetUser.id);

  if (!profile) {
    return msg.reply(
      `${targetUser.username} belum pernah ngobrol sama ${BOT_NAME}, jadi belum ada yang bisa ditampilkan.`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(
      isSelf
        ? `Hubunganmu dengan ${BOT_NAME}`
        : `Hubungan ${targetUser.username} dengan ${BOT_NAME}`
    )
    .addFields(
      { name: "Poin kedekatan", value: `${profile.affection}`, inline: true },
      { name: "Status", value: profile.label, inline: true },
      {
        name: "Panggilan",
        value: profile.nickname || "(belum ada)",
        inline: true,
      },
      {
        name: "Yang diingat",
        value: profile.facts.length
          ? profile.facts.map((f) => `• ${f}`).join("\n")
          : "(belum ada catatan)",
      }
    )
    .setColor(0xff69b4)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}