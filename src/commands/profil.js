import discordjs from "discord.js";
const { EmbedBuilder } = discordjs;

import { BOT_NAME } from "../config.js";
import {
  getCompanionProfile,
  getCompanionPublicProfile,
} from "../companion.js";

function truncateEmbedValue(text, maxLength = 1024) {
  if (!text) return "(empty)";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// `mprofil` -> view your own relationship profile.
// `mprofil @member` -> view what mokachan remembers about another member.
// Public profiles are read-only and do not create a new companion row.
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

  const relationship = profile.relationship;

  const relationshipText =
    profile.relationshipText ||
    (relationship
      ? `**Level ${relationship.level} — ${relationship.stageLabel}**`
      : "Relationship data is not available yet.");

  const factsText = profile.facts?.length
    ? profile.facts.map((f) => `- ${f}`).join("\n")
    : "(no notes yet)";

  const embed = new EmbedBuilder()
    .setTitle(
      isSelf
        ? `Your relationship with ${BOT_NAME}`
        : `${targetUser.username}'s relationship with ${BOT_NAME}`
    )
    .setDescription(truncateEmbedValue(relationshipText, 4096))
    .addFields(
      {
        name: "Nickname",
        value: profile.nickname || "(none yet)",
        inline: true,
      },
      {
        name: "Stage",
        value: profile.label || relationship?.stageLabel || "Unknown",
        inline: true,
      },
      {
        name: "What's remembered",
        value: truncateEmbedValue(factsText),
      }
    )
    .setColor(0xff69b4)
    .setFooter({ text: BOT_NAME })
    .setTimestamp();

  // Only show extra private stats when viewing your own profile.
  if (isSelf) {
    if (profile.interaction_count !== undefined) {
      embed.addFields({
        name: "Interactions",
        value: String(profile.interaction_count),
        inline: true,
      });
    }

    if (relationship) {
      embed.addFields({
        name: "Trust / Comfort / Familiarity",
        value: [
          `Trust: **${relationship.trustLabel}**`,
          `Comfort: **${relationship.comfortLabel}**`,
          `Familiarity: **${relationship.familiarityLabel}**`,
        ].join("\n"),
        inline: false,
      });
    }
  }

  return msg.reply({ embeds: [embed] });
}