import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// The database client.
//
// Local dev: a plain SQLite file at db/dev.db (via the embedded libsql
// engine — no native binary download, no external services).
//
// Production: point DATABASE_URL at a hosted Turso database (libSQL, fully
// SQLite-compatible) and set DATABASE_AUTH_TOKEN. Same code, same SQL,
// nothing else to change. See DEPLOYMENT.md.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __erendylDb: Client | undefined;
}

function resolveDbPath(): string {
  const dir = path.join(process.cwd(), "db");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "dev.db");
}

function makeClient(): Client {
  const url = process.env.DATABASE_URL ?? `file:${resolveDbPath()}`;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  return createClient(authToken ? { url, authToken } : { url });
}

export function getDb(): Client {
  if (!global.__erendylDb) {
    global.__erendylDb = makeClient();
  }
  return global.__erendylDb;
}

let schemaReady: Promise<void> | null = null;

/** Applies db/schema.sql idempotently, then runs one-time migrations. Safe to call on every request. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getDb();
    const schemaPath = path.join(process.cwd(), "db", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    // NOTE: this split is naive - it breaks the file on ANY semicolon that's
    // immediately followed by (optional whitespace, then a newline or EOF),
    // even one sitting inside a `--` comment line. A multi-line comment block
    // whose prose happens to end a line with a period-turned-semicolon (easy
    // to do by accident when writing design notes above a CREATE TABLE) gets
    // cut there, producing a comment-only "statement" that libSQL rejects
    // with SQL_PARSE_ERROR ("SQL string does not contain any statement") -
    // this took production down once (2026-07-04, Phase 3 launch) before the
    // isCommentOnly guard below was added. Comment lines in schema.sql must
    // never end with a bare `;` - and even so, the guard here strips any
    // stray comment-only chunk before it reaches db.execute().
    const isCommentOnly = (s: string) =>
      s.split("\n").every((line) => line.trim() === "" || line.trim().startsWith("--"));
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !isCommentOnly(s));
    // Index creation has to happen AFTER migrations, not interleaved with
    // table creation: several indexes are defined on campaign_id, and on an
    // existing pre-migration database that column doesn't exist on the old
    // table yet (CREATE TABLE IF NOT EXISTS is a no-op there). Running the
    // indexes here would fail with "no such column: campaign_id" before
    // runMigrations() ever gets a chance to add it. So: tables/pragmas first,
    // then migrations backfill campaign_id onto old tables, then indexes.
    // MUST match "create unique index" too, not just plain "create index" -
    // idx_characters_mask is a UNIQUE index and was slipping through this
    // check uncaught (missing the optional UNIQUE keyword), so it ran in the
    // tableStatements pass BEFORE runMigrations() added the mask column,
    // throwing "no such column: mask" on every cold start and permanently
    // wedging that instance's cached schemaReady promise (2026-07-06 -
    // production /admin and /login outage, see feedback_erendyl_fuse_staleness-
    // adjacent lesson: always re-check every regex like this against every
    // statement in the file, not just the ones that existed when it was written).
    const isIndexStmt = (s: string) => /^create\s+(unique\s+)?index/i.test(s);
    const tableStatements = statements.filter((s) => !isIndexStmt(s));
    const indexStatements = statements.filter(isIndexStmt);
    for (const stmt of tableStatements) {
      await db.execute(stmt);
    }
    await runMigrations(db);
    for (const stmt of indexStatements) {
      await db.execute(stmt);
    }
  })().catch((err) => {
    // Don't let a transient failure (or, as happened 2026-07-06, a genuine
    // bug) permanently wedge this warm serverless instance - every future
    // request on it would otherwise re-await the same rejected promise
    // forever until the instance recycles. Reset so the next call retries
    // from scratch instead.
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export function newId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Migrations. ensureSchema()'s CREATE TABLE IF NOT EXISTS pass only affects
// brand-new databases — it can't retrofit new columns or constraints onto
// tables that already exist from before this feature shipped. This runs
// once (checked via PRAGMA table_info) to bring an older database forward:
//
//  - Every content table gets a campaign_id column, backfilled onto a
//    single auto-created "Erendyl" campaign (LEGACY_CAMPAIGN_ID) so nothing
//    that already existed loses its home.
//  - Tables that had a bare `slug`/`name` UNIQUE constraint (moons, regions,
//    locations, factions, characters, storylines, artifacts, maps) need a
//    full rebuild, since SQLite can't alter a UNIQUE constraint in place —
//    a plain ALTER TABLE ADD COLUMN would leave old-style global uniqueness
//    in effect, which would make it impossible for two campaigns to both
//    have e.g. a moon named "Selune". Each rebuild runs as one atomic batch
//    (create new table, copy rows across with campaign_id filled in, drop
//    the old table, rename the new one into place, recreate its indexes).
//  - Tables with no such constraint (timeline_events, players,
//    entity_player_access) just get a plain ALTER TABLE ADD COLUMN.
// ---------------------------------------------------------------------------

export const LEGACY_CAMPAIGN_ID = "00000000-0000-0000-0000-000000000001";
const LEGACY_CAMPAIGN_SLUG = "erendyl";
const LEGACY_CAMPAIGN_NAME = "Erendyl";

async function hasColumn(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === column);
}

interface RebuildSpec {
  table: string;
  createNewTableSql: string;
  copyColumns: string; // comma-separated old column list, in the order the new table expects them (minus campaign_id)
  indexSql: string[];
}

const REBUILD_SPECS: RebuildSpec[] = [
  {
    table: "moons",
    copyColumns: "id, slug, name, cycle, domain, description, color, is_goddess, sort_order, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE moons_new (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL,
        name        TEXT NOT NULL,
        cycle       TEXT,
        domain      TEXT NOT NULL,
        description TEXT NOT NULL,
        color       TEXT,
        is_goddess  INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug),
        UNIQUE (campaign_id, name)
      )`,
    indexSql: ["CREATE INDEX IF NOT EXISTS idx_moons_campaign ON moons(campaign_id)"],
  },
  {
    table: "regions",
    copyColumns:
      "id, slug, name, type, capital, government, faith, moon_id, description, color, sort_order, revealed, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE regions_new (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        capital     TEXT,
        government  TEXT,
        faith       TEXT,
        moon_id     TEXT REFERENCES moons(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        color       TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        revealed    INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug),
        UNIQUE (campaign_id, name)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_regions_moon ON regions(moon_id)",
      "CREATE INDEX IF NOT EXISTS idx_regions_campaign ON regions(campaign_id)",
    ],
  },
  {
    table: "locations",
    copyColumns:
      "id, slug, name, type, parent_id, region_id, description, thumbnail_path, revealed, notes, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE locations_new (
        id             TEXT PRIMARY KEY,
        campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug           TEXT NOT NULL,
        name           TEXT NOT NULL,
        type           TEXT NOT NULL,
        parent_id      TEXT REFERENCES locations(id) ON DELETE SET NULL,
        region_id      TEXT REFERENCES regions(id) ON DELETE SET NULL,
        description    TEXT NOT NULL,
        thumbnail_path TEXT,
        revealed       INTEGER NOT NULL DEFAULT 1,
        notes          TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id)",
      "CREATE INDEX IF NOT EXISTS idx_locations_region ON locations(region_id)",
      "CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id)",
    ],
  },
  {
    table: "factions",
    copyColumns: "id, slug, name, type, region_id, description, goals, notes, revealed, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE factions_new (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        region_id   TEXT REFERENCES regions(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        goals       TEXT,
        notes       TEXT,
        revealed    INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug),
        UNIQUE (campaign_id, name)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_factions_region ON factions(region_id)",
      "CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id)",
    ],
  },
  {
    table: "characters",
    copyColumns:
      "id, slug, name, is_pc, is_alive, race, char_class, status, summary, bio, tags, portrait_path, revealed, location_id, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE characters_new (
        id            TEXT PRIMARY KEY,
        campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug          TEXT NOT NULL,
        name          TEXT NOT NULL,
        is_pc         INTEGER NOT NULL DEFAULT 0,
        is_alive      INTEGER NOT NULL DEFAULT 1,
        race          TEXT,
        char_class    TEXT,
        status        TEXT,
        summary       TEXT NOT NULL,
        bio           TEXT NOT NULL,
        tags          TEXT,
        portrait_path TEXT,
        revealed      INTEGER NOT NULL DEFAULT 1,
        location_id   TEXT REFERENCES locations(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(location_id)",
      "CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name)",
      "CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id)",
    ],
  },
  {
    table: "storylines",
    copyColumns:
      "id, slug, title, status, priority, summary, description, location_id, next_step, revealed, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE storylines_new (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL,
        priority    TEXT,
        summary     TEXT NOT NULL,
        description TEXT,
        location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
        next_step   TEXT,
        revealed    INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_storylines_location ON storylines(location_id)",
      "CREATE INDEX IF NOT EXISTS idx_storylines_campaign ON storylines(campaign_id)",
    ],
  },
  {
    table: "artifacts",
    copyColumns:
      "id, slug, name, type, rarity, attunement, owner_character_id, location_id, description, mechanics, image_path, revealed, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE artifacts_new (
        id                 TEXT PRIMARY KEY,
        campaign_id        TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug               TEXT NOT NULL,
        name               TEXT NOT NULL,
        type               TEXT NOT NULL,
        rarity             TEXT,
        attunement         INTEGER NOT NULL DEFAULT 0,
        owner_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
        location_id        TEXT REFERENCES locations(id) ON DELETE SET NULL,
        description        TEXT NOT NULL,
        mechanics          TEXT,
        image_path         TEXT,
        revealed           INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_character_id)",
      "CREATE INDEX IF NOT EXISTS idx_artifacts_location ON artifacts(location_id)",
      "CREATE INDEX IF NOT EXISTS idx_artifacts_campaign ON artifacts(campaign_id)",
    ],
  },
  {
    table: "maps",
    copyColumns: "id, slug, name, image_url, location_id, is_root, revealed, sort_order, created_at, updated_at",
    createNewTableSql: `
      CREATE TABLE maps_new (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        slug        TEXT NOT NULL,
        name        TEXT NOT NULL,
        image_url   TEXT NOT NULL,
        location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
        is_root     INTEGER NOT NULL DEFAULT 0,
        revealed    INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (campaign_id, slug)
      )`,
    indexSql: [
      "CREATE INDEX IF NOT EXISTS idx_maps_location ON maps(location_id)",
      "CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id)",
    ],
  },
];

async function runMigrations(db: Client): Promise<void> {
  // Make sure the legacy campaign exists before anything references it.
  await db.execute({
    sql: "INSERT OR IGNORE INTO campaigns (id, slug, name) VALUES (?, ?, ?)",
    args: [LEGACY_CAMPAIGN_ID, LEGACY_CAMPAIGN_SLUG, LEGACY_CAMPAIGN_NAME],
  });

  // CRITICAL: with foreign_keys=ON (set at the top of schema.sql), DROPping a
  // table that other tables reference via ON DELETE CASCADE fires those
  // cascades as if every row had been deleted individually. The rebuild
  // below drops and recreates `characters` and `maps`, which are referenced
  // by character_factions, storyline_characters, timeline_event_characters,
  // character_sheets, journal_entries, and map_pins - without this pragma
  // toggle, migrating an existing database would silently wipe every one of
  // those child rows. Caught by testing against a synthetic legacy database
  // before this ever touched real data. Must be set outside any transaction,
  // so this happens before the batch() calls below, not inside them.
  await db.execute("PRAGMA foreign_keys = OFF");

  for (const spec of REBUILD_SPECS) {
    if (await hasColumn(db, spec.table, "campaign_id")) continue; // already migrated
    const cols = spec.copyColumns;
    const newColsWithCampaign = cols.replace("id, ", "id, campaign_id, ");
    const selectWithCampaign = cols.replace("id, ", `id, '${LEGACY_CAMPAIGN_ID}', `);
    await db.batch(
      [
        spec.createNewTableSql,
        `INSERT INTO ${spec.table}_new (${newColsWithCampaign}) SELECT ${selectWithCampaign} FROM ${spec.table}`,
        `DROP TABLE ${spec.table}`,
        `ALTER TABLE ${spec.table}_new RENAME TO ${spec.table}`,
        ...spec.indexSql,
      ],
      "write"
    );
  }

  // Simple tables: no inline UNIQUE to rework, just add the column.
  const SIMPLE_TABLES = ["timeline_events", "players", "entity_player_access"];
  for (const table of SIMPLE_TABLES) {
    if (await hasColumn(db, table, "campaign_id")) continue;
    await db.execute(
      `ALTER TABLE ${table} ADD COLUMN campaign_id TEXT NOT NULL DEFAULT '${LEGACY_CAMPAIGN_ID}'`
    );
  }

  // Phase 2 of the "Section Creator": article_lists predates the
  // templates/articles tables (shipped in Phase 1), so an already-migrated
  // database's article_lists table won't have template_id yet. The
  // templates table itself is brand-new, so CREATE TABLE IF NOT EXISTS
  // above already handles it - only this ALTER is needed here.
  if (!(await hasColumn(db, "article_lists", "template_id"))) {
    await db.execute("ALTER TABLE article_lists ADD COLUMN template_id TEXT REFERENCES templates(id) ON DELETE SET NULL");
  }

  // Phase 3 of the "Section Creator": template_fields.field_type's CHECK
  // constraint needs 'reference' added, plus three new nullable columns
  // describing a reference field's target - SQLite can't ALTER a CHECK
  // constraint in place, so this needs the same drop-and-rebuild rebuild
  // pattern as REBUILD_SPECS above, just gated on a marker column existing
  // rather than campaign_id (foreign_keys is already OFF from above, so no
  // extra pragma toggle is needed here). article_references itself is a
  // brand-new table, already handled by CREATE TABLE IF NOT EXISTS.
  if (!(await hasColumn(db, "template_fields", "reference_target_type"))) {
    await db.batch(
      [
        `CREATE TABLE template_fields_new (
          id                     TEXT PRIMARY KEY,
          template_id            TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
          key                    TEXT NOT NULL,
          label                  TEXT NOT NULL,
          field_type             TEXT NOT NULL CHECK (field_type IN ('text','textarea','number','image','checkbox','heading','reference')),
          role                   TEXT CHECK (role IS NULL OR role IN ('title','subtitle','description','image')),
          reference_target_type  TEXT CHECK (reference_target_type IS NULL OR reference_target_type IN ('characters','locations','factions','storylines','artifacts','regions','custom')),
          reference_template_id  TEXT REFERENCES templates(id) ON DELETE SET NULL,
          reference_multiple     INTEGER NOT NULL DEFAULT 0,
          sort_order             INTEGER NOT NULL DEFAULT 0,
          created_at             TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (template_id, key)
        )`,
        `INSERT INTO template_fields_new (id, template_id, key, label, field_type, role, sort_order, created_at)
         SELECT id, template_id, key, label, field_type, role, sort_order, created_at FROM template_fields`,
        `DROP TABLE template_fields`,
        `ALTER TABLE template_fields_new RENAME TO template_fields`,
        "CREATE INDEX IF NOT EXISTS idx_template_fields_template ON template_fields(template_id)",
      ],
      "write"
    );
  }

  // Map regions became polygons (Aviv's call, 2026-07-06): the old fixed
  // x/y/width/height rectangle is replaced by a single `points` JSON column
  // (an ordered array of {x,y} fractional vertices), so a region can trace
  // an irregular location shape instead of being forced into a box. Existing
  // rectangle rows are converted in place to an equivalent 4-point polygon
  // via a pure-SQL string-concatenation INSERT...SELECT (no need to read
  // rows into JS - SQLite's `||` operator builds the JSON text directly).
  // No foreign_keys pragma concern here - unlike the characters/maps
  // rebuilds above, nothing else cascades FROM map_regions as a parent, so
  // dropping/recreating it can't wipe rows in any other table.
  if (!(await hasColumn(db, "map_regions", "points"))) {
    await db.batch(
      [
        `CREATE TABLE map_regions_new (
          id          TEXT PRIMARY KEY,
          map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
          location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
          points      TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `INSERT INTO map_regions_new (id, map_id, location_id, points, created_at, updated_at)
         SELECT id, map_id, location_id,
           '[{"x":' || x || ',"y":' || y || '},{"x":' || (x + width) || ',"y":' || y || '},{"x":' || (x + width) || ',"y":' || (y + height) || '},{"x":' || x || ',"y":' || (y + height) || '}]',
           created_at, updated_at
         FROM map_regions`,
        "DROP TABLE map_regions",
        "ALTER TABLE map_regions_new RENAME TO map_regions",
        "CREATE INDEX IF NOT EXISTS idx_map_regions_map ON map_regions(map_id)",
        "CREATE INDEX IF NOT EXISTS idx_map_regions_location ON map_regions(location_id)",
      ],
      "write"
    );
  }

  // Discord bot masks/account-linking (2026-07-06): plain ALTER TABLE ADD
  // COLUMN is enough here - neither column had an inline UNIQUE in the old
  // shipped schema to rework, so this doesn't need the drop/rebuild dance
  // REBUILD_SPECS uses above. The corresponding UNIQUE indexes are declared
  // in schema.sql and get created by ensureSchema()'s index pass right after
  // this function returns, once these columns actually exist.
  if (!(await hasColumn(db, "characters", "mask"))) {
    await db.execute("ALTER TABLE characters ADD COLUMN mask TEXT");
  }
  if (!(await hasColumn(db, "players", "discord_user_id"))) {
    await db.execute("ALTER TABLE players ADD COLUMN discord_user_id TEXT");
  }

  // Playlists / scene-tagging (2026-07-10): music_tracks already existed in
  // production, so its new `scene` column needs the same hasColumn-guarded
  // ALTER TABLE as the mask/discord_user_id columns above - playlists and
  // playlist_tracks are brand new tables and don't need migrating, since
  // ensureSchema()'s CREATE TABLE IF NOT EXISTS pass already handles them.
  if (!(await hasColumn(db, "music_tracks", "scene"))) {
    await db.execute("ALTER TABLE music_tracks ADD COLUMN scene TEXT");
  }

  await db.execute("PRAGMA foreign_keys = ON");
}
