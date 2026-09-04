// ==================== AUTOMATIC MAINTENANCE ====================
// Automatic handling for disk space issues, no MySQL or manual
// intervention required.
//
// 1. Incremental vacuum -- reclaims free space from deleted rows in
//    small bounded chunks on a schedule, instead of one large VACUUM
//    that needs roughly as much temp disk space as the entire
//    database file (and can fail once disk is already tight -- see
//    incrementalVacuum() in database.js for details).
// 2. Critical-space guard -- skips the vacuum step entirely once free
//    space drops below a hard floor, so maintenance itself can never
//    be the thing that fills the disk (this is what happened before:
//    a VACUUM call was attempted with ~80 MB free and its temp copy
//    ran the disk all the way to 0, taking every subsequent write down
//    with it via SQLITE_FULL).
// 3. Disk space monitoring -- checks remaining disk space regularly
//    and warns the notify channel once it gets low, before it runs
//    out completely and starts causing write errors.

import { statfs } from "node:fs/promises";
import { incrementalVacuum, getVacuumStatus } from "./database.js";
import { NOTIFY_CHANNEL_ID, BOT_NAME } from "./config.js";

const DISK_WARNING_THRESHOLD_MB = 100; // below this is considered "low"
const DISK_CRITICAL_THRESHOLD_MB = 25; // below this, don't touch VACUUM at all -- not enough headroom for any temp copy
let alreadyWarned = false; // avoid spamming the warning every cycle while still low

export async function getFreeDiskMB() {
  try {
    const stats = await statfs(process.cwd());
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes / (1024 * 1024);
  } catch (error) {
    console.error("Failed to check disk space:", error.message);
    return null;
  }
}

export async function checkDiskSpace(client, freeMB = undefined) {
  if (freeMB === undefined) {
    freeMB = await getFreeDiskMB();
  }
  if (freeMB === null) return;

  if (freeMB < DISK_WARNING_THRESHOLD_MB) {
    console.warn(`Disk space is low: ~${freeMB.toFixed(1)} MB free.`);

    if (!alreadyWarned && NOTIFY_CHANNEL_ID) {
      alreadyWarned = true;

      try {
        const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);
        await channel?.send(
          `[${BOT_NAME}] Warning: hosting disk space is low (~${freeMB.toFixed(
            1
          )} MB free). Please check or clean up disk space soon.`
        );
      } catch (error) {
        console.error("Failed to send disk space warning:", error.message);
      }
    }
  } else {
    alreadyWarned = false;
  }
}

export async function runMaintenance(client) {
  const freeMB = await getFreeDiskMB();

  if (freeMB !== null && freeMB < DISK_CRITICAL_THRESHOLD_MB) {
    console.warn(
      `Skipping vacuum this cycle: only ~${freeMB.toFixed(
        1
      )} MB free (below critical floor of ${DISK_CRITICAL_THRESHOLD_MB} MB). ` +
        `Free up disk space externally before vacuum can safely run again.`
    );
  } else {
    try {
      const before = await getVacuumStatus();
      await incrementalVacuum(200);
      const after = await getVacuumStatus();

      console.log(
        `Incremental vacuum done. Free pages before: ${before.freePages}, after: ${after.freePages} ` +
          `(mode: ${after.persistedAutoVacuumMode === 2 ? "incremental" : "not incremental yet"}).`
      );

      if (after.persistedAutoVacuumMode !== 2) {
        console.error(
          "auto_vacuum is not persisted as INCREMENTAL -- incremental_vacuum calls are currently a no-op. " +
            "Run convertToIncrementalVacuum() manually once, with plenty of free disk space."
        );
      }
    } catch (error) {
      console.error("Incremental vacuum failed:", error.message);
    }
  }

  await checkDiskSpace(client, freeMB);
}