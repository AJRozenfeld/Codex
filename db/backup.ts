/* eslint-disable no-console */
import { createClient, type Client } from "@libsql/client";

// ---------------------------------------------------------------------------
// Full-database logical backup (2026-07-16). Connects to whatever
// DATABASE_URL/DATABASE_AUTH_TOKEN point at (hosted Turso in CI, the local
// file db in dev) and writes a complete, self-contained SQL dump to stdout:
// every user table's CREATE statement, every index, and every row as an
// INSERT. Restoring it into an EMPTY database (see restore.ts) reproduces
// the exact state.
//
// Run by .github/workflows/backup.yml nightly; run it locally any time with:
//   npm run backup > backup.sql
//
// Why a hand-rolled dump instead of the turso CLI: zero extra dependencies,
// works identically against the embedded file engine and hosted Turso, and
// the output is plain SQL any SQLite tool can read.
// ---------------------------------------------------------------------------

function makeClient(): Client {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set - refusing to guess which database to back up.");
    process.exit(1);
  }
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  return createClient(authToken ? { url, authToken } : { url });
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
    return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  // Strings (and anything else, stringified): single quotes doubled per SQL.
  // Newlines/carriage returns are emitted as char(10)/char(13) concatenations
  // so every INSERT stays on ONE physical line - restore.ts splits the dump
  // on ";\n", and a bio whose text line happened to end with a semicolon
  // would otherwise shear the statement mid-string.
  const escaped = String(v)
    .replace(/'/g, "''")
    .replace(/\r/g, "'||char(13)||'")
    .replace(/\n/g, "'||char(10)||'");
  return `'${escaped}'`;
}

async function main() {
  const db = makeClient();

  // Schema objects: user tables + their indexes, in creation order. Skip
  // SQLite internals (sqlite_sequence etc.) and auto-created UNIQUE indexes
  // (sql IS NULL) - those come back automatically with their CREATE TABLE.
  const schema = await db.execute(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`
  );

  const tables = schema.rows.filter((r) => r.type === "table").map((r) => r.name as string);

  const out: string[] = [];
  out.push(`-- Erendyl Codex logical backup`);
  out.push(`-- created: ${new Date().toISOString()}`);
  out.push(`-- tables: ${tables.length}`);
  out.push(`PRAGMA foreign_keys = OFF;`);

  for (const row of schema.rows) {
    // Normalize to exactly one trailing semicolon so restore.ts's
    // one-statement-per-chunk split stays trivial.
    out.push(`${String(row.sql).replace(/;\s*$/, "")};`);
  }

  let totalRows = 0;
  for (const table of tables) {
    const rows = await db.execute(`SELECT * FROM ${JSON.stringify(table)}`);
    if (rows.rows.length === 0) continue;
    const cols = rows.columns;
    const colList = cols.map((c) => JSON.stringify(c)).join(", ");
    for (const r of rows.rows) {
      const values = cols.map((c) => sqlLiteral((r as Record<string, unknown>)[c])).join(", ");
      out.push(`INSERT INTO ${JSON.stringify(table)} (${colList}) VALUES (${values});`);
    }
    totalRows += rows.rows.length;
  }

  out.push(`PRAGMA foreign_keys = ON;`);
  out.push(`-- end of backup: ${totalRows} rows across ${tables.length} tables`);
  process.stdout.write(out.join("\n") + "\n");
  console.error(`backup complete: ${tables.length} tables, ${totalRows} rows`);
}

main().catch((err) => {
  console.error("BACKUP FAILED:", err);
  process.exit(1);
});
