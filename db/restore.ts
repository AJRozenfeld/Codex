/* eslint-disable no-console */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Restores a backup.ts dump into the database DATABASE_URL points at.
//
//   npm run restore -- backup.sql
//
// SAFETY RAILS - read before using in anger:
//   - The target database must be EMPTY (no user tables), or you must pass
//     --force, which DROPS every existing user table first. There is no
//     merge; a restore replaces the world with the snapshot.
//   - Point DATABASE_URL at the database you are restoring INTO. For a real
//     disaster drill against production Turso, that means running this from
//     a machine with the prod URL + token - deliberately manual; restoring
//     production should never be an accident.
//   - After restore, the app's ensureSchema() will fast-path on the restored
//     schema_meta stamp, or re-run its idempotent pass if the snapshot
//     predates a migration - both safe.
// ---------------------------------------------------------------------------

function makeClient(): Client {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set - refusing to guess which database to restore into.");
    process.exit(1);
  }
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  return createClient(authToken ? { url, authToken } : { url });
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: npm run restore -- <backup.sql> [--force]");
    process.exit(1);
  }
  const sqlText = fs.readFileSync(file, "utf-8");
  const statements = sqlText
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((line) => line.trim() === "" || line.trim().startsWith("--")));

  const db = makeClient();

  const existing = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  if (existing.rows.length > 0) {
    if (!force) {
      console.error(
        `Target database is NOT empty (${existing.rows.length} tables). ` +
          `Re-run with --force to DROP everything and restore over it. No merge exists - this replaces all data.`
      );
      process.exit(1);
    }
    console.error(`--force: dropping ${existing.rows.length} existing tables...`);
    await db.execute("PRAGMA foreign_keys = OFF");
    for (const row of existing.rows) {
      await db.execute(`DROP TABLE IF EXISTS ${JSON.stringify(row.name as string)}`);
    }
  }

  // The dump carries its own PRAGMA lines, but executing them naively is a
  // trap: the trailing "foreign_keys = ON" would run in a pragmas-first pass
  // and re-arm FK enforcement BEFORE any data exists (caught in the local
  // restore drill, 2026-07-16 - FOREIGN KEY constraint failed on the first
  // insert batch). So: skip every pragma from the file; this script manages
  // foreign_keys itself - OFF for the whole load, ON at the end.
  const isPragma = (s: string) => /^pragma\b/i.test(s);
  await db.execute("PRAGMA foreign_keys = OFF");
  const work = statements.filter((s) => !isPragma(s));
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    await db.batch(work.slice(i, i + BATCH), "write");
    done += Math.min(BATCH, work.length - i);
    console.error(`  ${done}/${work.length} statements applied`);
  }
  await db.execute("PRAGMA foreign_keys = ON");

  const tables = await db.execute(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  console.error(`restore complete: ${tables.rows[0].n} tables live.`);
}

main().catch((err) => {
  console.error("RESTORE FAILED:", err);
  process.exit(1);
});
