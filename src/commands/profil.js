import discordjs from "discord.js";
const { EmbedBuilder } = discordjs;
import { BOT_NAME } from "../config.js";
import {
  getCompanionProfile,
  getCompanionPublicProfile,
} from "../companion.js";

// `mprofil` -> view your own profile (auto-created if it doesn't exist yet).
// `mprofil @member` -> view what mokachan remembers about another member
// (read-only, doesn't create a new row), so members can get to know each
// other through the bot.
export async function handleProfilCommand(msg) {
  const targetUser = msg.mentions.users.first() || msg.author;
  const isSelf = targetUser.id === msg.author.id;

  const profile = isSelf
    ? await getCompanionProfile(targetUser.id)
    : await getCompanionPublicProfile(targetUser.id);

  if (!profile) {
    return msg.reply(
      `${targetUser.username} has never chatted with ${BOT_NAME} yet, so there's nothing to show.`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(
      isSelf
        ? `Your relationship with ${BOT_NAME}`
        : `${targetUser.username}'s relationship with ${BOT_NAME}`
    )
    .addFields(
      { name: "Affection points", value: `${profile.affection}`, inline: true },
      { name: "Status", value: profile.label, inline: true },
      {
        name: "Nickname",
        value: profile.nickname || "(none yet)",
        inline: true,
      },
      {
        name: "What's remembered",
        value: profile.facts.length
          ? profile.facts.map((f) => `- ${f}`).join("\n")
          : "(no notes yet)",
      }
    )
    .setColor(0xff69b4)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}