import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  ssl: "require",
  prepare: false,
});

async function upgrade() {
  console.log("Upgrading companion_memory for Relationship XP system...");

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS relationship_xp INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS trust INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS comfort INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS familiarity INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS interaction_count INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS xp_day INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE companion_memory
    ADD COLUMN IF NOT EXISTS xp_day_date TEXT NOT NULL DEFAULT ''
  `;

  console.log("Columns added/verified.");

  // Convert old affection points into starting Relationship XP.
  // Old affection is multiplied by 8 so existing users do not start from zero.
  // This only runs for rows that still have relationship_xp = 0.
  await sql`
    UPDATE companion_memory
    SET
      relationship_xp = GREATEST(relationship_xp, COALESCE(affection, 0) * 8),
      trust = GREATEST(trust, LEAST(100, COALESCE(affection, 0) / 2)),
      comfort = GREATEST(comfort, LEAST(100, COALESCE(affection, 0) / 2)),
      familiarity = GREATEST(familiarity, LEAST(100, COALESCE(affection, 0) / 2))
    WHERE relationship_xp = 0
  `;

  console.log("Old affection converted to Relationship XP.");

  const rows = await sql`
    SELECT
      user_id,
      affection,
      relationship_xp,
      trust,
      comfort,
      familiarity
    FROM companion_memory
    ORDER BY relationship_xp DESC
  `;

  console.log("Current relationship data:");
  console.table(rows);

  await sql.end();
  console.log("Upgrade complete.");
}

upgrade().catch(async (err) => {
  console.error("Upgrade failed:", err.message);
  await sql.end();
  process.exit(1);
});