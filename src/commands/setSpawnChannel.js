import discordjs from "discord.js";
const { PermissionFlagsBits } = discordjs;
import { setSetting } from "../database.js";
import { PREFIX, COMMANDS } from "../config.js";
import { invalidateSpawnChannelCache } from "../characterSpawn.js";

export async function handleSetSpawnChannelCommand(msg) {
  const isAdmin =
    msg.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    msg.member?.permissions?.has(PermissionFlagsBits.Administrator);

  if (!isAdmin) {
    return msg.reply(
      "Cuma admin/moderator server (izin *Manage Server*) yang boleh atur channel spawn."
    );
  }

  await setSetting("spawn_channel_id", msg.channel.id);
  invalidateSpawnChannelCache();

  return msg.reply(
    `Channel ini (<#${msg.channel.id}>) sekarang jadi channel resmi untuk spawn karakter.\n` +
      `Karakter cuma akan muncul di sini. Ketik \`${PREFIX}${COMMANDS.claim}\` saat ada yang muncul!`
  );
}