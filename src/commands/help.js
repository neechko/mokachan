import { EmbedBuilder } from "discord.js";
import { BOT_NAME, PREFIX, COMMANDS } from "../config.js";

export async function handleHelpCommand(msg) {
  const embed = new EmbedBuilder()
    .setTitle(`📖 ${BOT_NAME} Commands`)
    .setColor(0x00ffff)
    .setDescription(
      `**${PREFIX}${COMMANDS.ai} [pertanyaan]** - Tanya ${BOT_NAME} menggunakan Gemini\n` +
      `**${PREFIX}${COMMANDS.lyrics} [judul lagu]** - Cari lirik lagu\n` +
      `**${PREFIX}${COMMANDS.history}** - Lihat chat terakhir\n` +
      `**${PREFIX}${COMMANDS.clearHistory}** - Hapus semua history\n` +
      `**${PREFIX}${COMMANDS.stats}** - Statistik penggunaan Gemini\n` +
      `**${PREFIX}${COMMANDS.ping}** - Cek latency\n` +
      `**${PREFIX}${COMMANDS.help}** - Tampilkan command`
    )
    .setFooter({ text: `${BOT_NAME}` })
    .setTimestamp();

  return msg.reply({ embeds: [embed] });
}
