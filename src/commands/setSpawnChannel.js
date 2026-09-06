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
      "Only a server admin/moderator (Manage Server permission) can set the spawn channel."
    );
  }

  await setSetting("spawn_channel_id", msg.channel.id);
  invalidateSpawnChannelCache();

  return msg.reply(
    `This channel (<#${msg.channel.id}>) is now the official character spawn channel.\n` +
      `Characters will only appear here. Type \`${PREFIX}${COMMANDS.claim}\` when one shows up!`
  );
}