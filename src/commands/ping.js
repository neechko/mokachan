import { EmbedBuilder } from "discord.js";

export async function handlePingCommand(msg) {
  const latency = Date.now() - msg.createdTimestamp;

  const embed = new EmbedBuilder()
    .setTitle("🏓 Pong!")
    .setColor(0x00ff00)
    .setDescription(`Latency: ${latency}ms`);

  return msg.reply({ embeds: [embed] });
}
