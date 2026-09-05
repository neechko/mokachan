import discordjs from "discord.js";
const { PermissionFlagsBits } = discordjs;
import { convertToIncrementalVacuum, getVacuumStatus } from "../database.js";

// One-time, admin-only command to convert the existing database file
// into true incremental auto-vacuum mode. Setting the PRAGMA alone on
// startup is not enough for a non-empty database -- it only takes
// effect after a full VACUUM completes, which this triggers safely
// (vacuumDatabase() refuses to run without a comfortable free-space
// margin, so this can't be the thing that fills the disk).
//
// Safe to run more than once -- it's a no-op if the database is
// already in incremental mode.
export async function handleVacuumConvertCommand(msg) {
  const isAdmin =
    msg.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    msg.member?.permissions?.has(PermissionFlagsBits.Administrator);

  if (!isAdmin) {
    return msg.reply(
      "Only a server admin/moderator (Manage Server permission) can run this."
    );
  }

  const before = await getVacuumStatus();

  if (before.persistedAutoVacuumMode === 2) {
    return msg.reply(
      "Database is already in incremental auto-vacuum mode. Nothing to do."
    );
  }

  await msg.reply(
    "Converting database to incremental auto-vacuum mode. This runs a one-time full VACUUM, which may take a moment..."
  );

  try {
    const result = await convertToIncrementalVacuum();
    const after = await getVacuumStatus();

    const dbSizeMB = (
      (after.totalPages * after.pageSizeBytes) /
      (1024 * 1024)
    ).toFixed(2);

    return msg.reply(
      result.converted
        ? `Conversion complete. Database is now in incremental auto-vacuum mode (current size: ${dbSizeMB} MB, ${after.freePages} free pages remaining).`
        : "Database was already in incremental auto-vacuum mode."
    );
  } catch (error) {
    return msg.reply(`Conversion failed: ${error.message}`);
  }
}