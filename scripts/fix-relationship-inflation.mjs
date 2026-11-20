import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  ssl: "require",
  prepare: false,
});

const DIVISOR = 3;
const CURVE = parseInt(process.env.REL_XP_CURVE, 10) || 100;

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / CURVE)) + 1;
}

function traitCapForLevel(level) {
  return Math.min(100, 8 + level * 7);
}

async function fix() {
  console.log("Deflating legacy relationship data...");

  const rows = await sql`
    SELECT user_id, relationship_xp, trust, comfort, familiarity
    FROM companion_memory
  `;

  for (const row of rows) {
    const newXp = Math.floor((Number(row.relationship_xp) || 0) / DIVISOR);
    const level = levelFromXp(newXp);
    const cap = traitCapForLevel(level);

    const trust = Math.min(cap, Math.floor((Number(row.trust) || 0) / DIVISOR));
    const comfort = Math.min(cap, Math.floor((Number(row.comfort) || 0) / DIVISOR));
    const familiarity = Math.min(
      cap,
      Math.floor((Number(row.familiarity) || 0) / DIVISOR)
    );

    await sql`
      UPDATE companion_memory
      SET
        relationship_xp = ${newXp},
        trust = ${trust},
        comfort = ${comfort},
        familiarity = ${familiarity},
        xp_day = 0,
        xp_day_date = ''
      WHERE user_id = ${row.user_id}
    `;
  }

  const after = await sql`
    SELECT user_id, relationship_xp, trust, comfort, familiarity
    FROM companion_memory
    ORDER BY relationship_xp DESC
  `;

  console.log("After deflation:");
  console.table(
    after.map((r) => ({
      user_id: r.user_id,
      xp: r.relationship_xp,
      level: levelFromXp(r.relationship_xp),
      trust: r.trust,
      comfort: r.comfort,
      familiarity: r.familiarity,
    }))
  );

  await sql.end();
  console.log("Done.");
}

fix().catch(async (err) => {
  console.error("Failed:", err.message);
  await sql.end();
  process.exit(1);
});