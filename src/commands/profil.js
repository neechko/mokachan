import { EmbedBuilder } from "discord.js";
import { BOT_NAME } from "../config.js";
import { getCompanionProfile } from "../companion.js";

export async function handleProfilCommand(msg) {
  const profile = await getCompanionProfile(msg.author.id);

  const embed = new EmbedBuilder()
    .setTitle(`Hubunganmu dengan ${BOT_NAME}`)
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