import discordjs from "discord.js";
const { EmbedBuilder } = discordjs;
import { BOT_NAME, PREFIX, COMMANDS } from "../config.js";

export async function handleHelpCommand(msg) {
  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} Commands`)
    .setColor(0x00ffff)
    .setDescription(
      `**${PREFIX}${COMMANDS.ai} [question]** - Ask ${BOT_NAME} using Gemini\n` +
      `**${PREFIX}${COMMANDS.lyrics} [song title]** - Look up song lyrics\n` +
      `**${PREFIX}${COMMANDS.history}** - View recent chat history\n` +
      `**${PREFIX}${COMMANDS.clearHistory}** - Clear all history\n` +
      `**${PREFIX}${COMMANDS.stats}** - Gemini usage statistics\n` +
      `**${PREFIX}${COMMANDS.profil}** - View your closeness with ${BOT_NAME}\n` +
      `**${PREFIX}${COMMANDS.resetcompanion}** - Reset companion memory\n` +
      `**${PREFIX}${COMMANDS.claim}** - Claim the currently active character\n` +
      `**${PREFIX}${COMMANDS.koleksi}** - View your character collection\n` +
      `**${PREFIX}${COMMANDS.setSpawnChannel}** - (admin) set the official character spawn channel\n` +
      `**${PREFIX}${COMMANDS.diskusage}** - Show disk usage breakdown\n` +
      `**${PREFIX}${COMMANDS.vacuumconvert}** - (admin) one-time database vacuum conversion\n` +
      `**${PREFIX}${COMMANDS.ping}** - Check latency\n` +
      `**${PREFIX}${COMMANDS.help}** - Show commands`
    )
    .setFooter({ text: `${BOT_NAME}` })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}