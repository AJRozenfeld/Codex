import { getDb, ensureSchema, newId, LEGACY_DM_ID } from "./db";
import { slugify } from "./slug";
import { hashPassword } from "./password";
import { uploadMapImage, uploadCharacterPortrait } from "./blob-storage";
import { getCharacterSheet, mergeWithDefaults } from "./character-sheet";
import {
  rowToMoon,
  rowToRegion,
  rowToLocation,
  rowToCharacter,
  rowToFaction,
  rowToStoryline,
  rowToArtifact,
  rowToTimelineEvent,
  rowToMap,
  rowToMapPin,
  rowToMapRegion,
  rowToSection,
  rowToTemplate,
  rowToTemplateField,
  rowToArticle,
  getTemplateWithFields,
  resolveCharacterAnchor,
  polygonCentroid,
  parseRegionPoints,
  type RegionAnchor,
} from "./queries";
import type {
  Moon,
  Region,
  Location,
  Character,
  Faction,
  Storyline,
  Artifact,
  TimelineEvent,
  Player,
  MapEntity,
  MapPin,
  MapRegion,
  MapRegionPoint,
  AdminCharacterMapToken,
  Section,
  AdminArticleList,
  SectionEntityType,
  Template,
  TemplateWithFields,
  TemplateField,
  TemplateFieldType,
  TemplateFieldRole,
  Article,
  ArticleData,
  CharacterSheetData,
} from "./types";

// ---------------------------------------------------------------------------
// ADMIN read/write layer - sees every row regardless of `revealed`, and is
// the only layer allowed to mutate data. Every exported function here must
// only ever be called from code behind requireAdmin() (see auth.ts).
//
// Every function below takes a campaignId as its first argument and scopes
// every query to it - both the list/read side (so switching the campaign
// dropdown actually changes what you see) and the write/delete side (so a
// stale id from a campaign you've since switched away from can never read
// or mutate a different campaign's row, even defensively). Slugs are unique
// per campaign_id now (see schema.sql), so uniqueSlug() checks scoped to
// the campaign too - the same slug can exist in two different campaigns.
// ---------------------------------------------------------------------------

// Tables that carry a `revealed` column (everything except moons, which are
// always public cosmology) vs. tables that can simply be bulk-deleted.
const REVEALABLE_TABLES = new Set([
  "regions",
  "locations",
  "characters",
  "factions",
  "storylines",
  "artifacts",
  "timeline_events",
  "maps",
  "sections",
  "articles",
]);
const DELETABLE_TABLES = new Set([...REVEALABLE_TABLES, "moons", "players"]);

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

// ---------------------------------------------------------------------------
// License quotas (2026-07-16). Every campaign's limits come from its owning
// dm_accounts row. "Articles" means every codex entry a DM posts - the
// tables below - counted together per campaign. Maps and players have their
// own per-campaign limits. Moons are excluded (founder-only cosmology), and
// so are DM-side tools that aren't player-facing codex content (creatures
// bestiary, scenes, music, templates).
// ---------------------------------------------------------------------------

const ARTICLE_COUNT_TABLES = [
  "regions",
  "locations",
  "characters",
  "factions",
  "storylines",
  "artifacts",
  "timeline_events",
  "sections",
  "articles",
];

/** Which quota pool a slug-carrying table's creations draw from. */
const ARTICLE_QUOTA_TABLES = new Set(ARTICLE_COUNT_TABLES.filter((t) => t !== "timeline_events"));

export async function assertCreateQuota(campaignId: string, kind: "articles" | "maps" | "players"): Promise<void> {
  const db = getDb();
  const limitsR = await db.execute({
    sql: `SELECT d.max_players_per_campaign AS mp, d.max_articles_per_campaign AS ma, d.max_maps_per_campaign AS mm
          FROM campaigns c JOIN dm_accounts d ON d.id = c.dm_id WHERE c.id = ?`,
    args: [campaignId],
  });
  const limits = limitsR.rows[0];
  if (!limits) return; // no campaign row - let the write itself surface the real error
  if (kind === "players") {
    const n = await db.execute({ sql: "SELECT COUNT(*) AS n FROM players WHERE campaign_id = ?", args: [campaignId] });
    if (Number(n.rows[0].n) >= Number(limits.mp)) {
      throw new Error(`License limit reached: this campaign can have at most ${limits.mp} players.`);
    }
  } else if (kind === "maps") {
    const n = await db.execute({ sql: "SELECT COUNT(*) AS n FROM maps WHERE campaign_id = ?", args: [campaignId] });
    if (Number(n.rows[0].n) >= Number(limits.mm)) {
      throw new Error(`License limit reached: this campaign can have at most ${limits.mm} maps.`);
    }
  } else {
    const counts = await Promise.all(
      ARTICLE_COUNT_TABLES.map((t) =>
        db.execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE campaign_id = ?`, args: [campaignId] })
      )
    );
    const total = counts.reduce((sum, r) => sum + Number(r.rows[0].n), 0);
    if (total >= Number(limits.ma)) {
      throw new Error(
        `License limit reached: this campaign can have at most ${limits.ma} articles (every codex entry counts: characters, locations, factions, storylines, artifacts, regions, timeline events, sections and template articles).`
      );
    }
  }
}

/** Flips `revealed` (1<->0) for every selected row in one table, scoped to the current campaign. */
export async function adminBulkToggleRevealed(campaignId: string, table: string, ids: string[]): Promise<void> {
  if (!REVEALABLE_TABLES.has(table) || ids.length === 0) return;
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE ${table} SET revealed = 1 - revealed, updated_at = datetime('now') WHERE campaign_id = ? AND id IN (${placeholders(ids.length)})`,
    args: [campaignId, ...ids],
  });
}

/** Deletes every selected row in one table (child join rows cascade via FK), scoped to the current campaign. */
export async function adminBulkDelete(campaignId: string, table: string, ids: string[]): Promise<void> {
  if (!DELETABLE_TABLES.has(table) || ids.length === 0) return;
  await ensureSchema();
  await getDb().execute({
    sql: `DELETE FROM ${table} WHERE campaign_id = ? AND id IN (${placeholders(ids.length)})`,
    args: [campaignId, ...ids],
  });
}

async function uniqueSlug(campaignId: string, table: string, base: string, excludeId?: string): Promise<string> {
  // Every content-creation path in this file funnels through here (no
  // excludeId = a brand-new row), which makes it the single choke point for
  // the per-campaign license quotas. Timeline events don't carry slugs and
  // get their own explicit check at their INSERT; moons are exempt.
  if (!excludeId) {
    if (ARTICLE_QUOTA_TABLES.has(table)) await assertCreateQuota(campaignId, "articles");
    else if (table === "maps") await assertCreateQuota(campaignId, "maps");
  }
  const db = getDb();
  let slug = slugify(base) || "item";
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({
      sql: `SELECT id FROM ${table} WHERE campaign_id = ? AND slug = ? ${excludeId ? "AND id != ?" : ""}`,
      args: excludeId ? [campaignId, slug, excludeId] : [campaignId, slug],
    });
    if (r.rows.length === 0) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

/** Same as uniqueSlug, but for the (deliberately global, campaign-less) `templates` table. */
async function uniqueGlobalSlug(table: string, base: string, excludeId?: string): Promise<string> {
  const db = getDb();
  let slug = slugify(base) || "item";
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({
      sql: `SELECT id FROM ${table} WHERE slug = ? ${excludeId ? "AND id != ?" : ""}`,
      args: excludeId ? [slug, excludeId] : [slug],
    });
    if (r.rows.length === 0) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

/** Machine key for a template field, unique within its own template. Fixed at creation - see adminUpdateTemplateField. */
async function uniqueFieldKey(templateId: string, label: string, excludeId?: string): Promise<string> {
  const db = getDb();
  let key = slugify(label).replace(/-/g, "_") || "field";
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({
      sql: `SELECT id FROM template_fields WHERE template_id = ? AND key = ? ${excludeId ? "AND id != ?" : ""}`,
      args: excludeId ? [templateId, key, excludeId] : [templateId, key],
    });
    if (r.rows.length === 0) return key;
    n += 1;
    key = `${slugify(label).replace(/-/g, "_")}_${n}`;
  }
}

// ---------------------------------------------------------------------------
// Per-player whole-entity visibility (entity_player_access). Empty list =
// visible to every player (the normal case). Any entries = visible ONLY to
// those players, on top of the usual `revealed = 1` gate. entityType must be
// one of REVEALABLE_TABLES' names, matching what queries.ts checks against.
// entity_id already belongs to exactly one campaign (it's the row's own
// primary key), so reads don't need a campaignId - only the insert needs one
// to populate the NOT NULL campaign_id column.
// ---------------------------------------------------------------------------

export async function adminGetRestrictedPlayerIds(entityType: string, entityId: string): Promise<string[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT player_id FROM entity_player_access WHERE entity_type = ? AND entity_id = ?",
    args: [entityType, entityId],
  });
  return r.rows.map((row) => row.player_id as string);
}

export async function adminSetRestrictedPlayerIds(
  campaignId: string,
  entityType: string,
  entityId: string,
  playerIds: string[]
): Promise<void> {
  if (!REVEALABLE_TABLES.has(entityType)) return;
  await ensureSchema();
  const db = getDb();
  // Single batch = one round trip (and atomic), instead of 1 + N executes.
  await db.batch(
    [
      {
        sql: "DELETE FROM entity_player_access WHERE entity_type = ? AND entity_id = ?",
        args: [entityType, entityId],
      },
      ...playerIds.map((playerId) => ({
        sql: "INSERT INTO entity_player_access (id, campaign_id, entity_type, entity_id, player_id) VALUES (?,?,?,?,?)",
        args: [newId(), campaignId, entityType, entityId, playerId],
      })),
    ],
    "write"
  );
}

// ---- Moons ------------------------------------------------------------

export async function adminGetMoons(campaignId: string): Promise<Moon[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM moons WHERE campaign_id = ? ORDER BY sort_order ASC, name ASC",
    args: [campaignId],
  });
  return r.rows.map(rowToMoon);
}

export async function adminGetMoon(campaignId: string, id: string): Promise<Moon | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM moons WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
  return r.rows[0] ? rowToMoon(r.rows[0]) : null;
}

export interface MoonInput {
  name: string;
  cycle?: string;
  domain: string;
  description: string;
  color?: string;
  isGoddess: boolean;
  sortOrder: number;
}

export async function adminUpsertMoon(campaignId: string, input: MoonInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "moons", input.name, id);
  if (id) {
    await db.execute({
      sql: `UPDATE moons SET name=?, slug=?, cycle=?, domain=?, description=?, color=?, is_goddess=?, sort_order=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.cycle ?? null, input.domain, input.description, input.color ?? null, input.isGoddess ? 1 : 0, input.sortOrder, id, campaignId],
    });
    return id;
  }
  const newIdVal = newId();
  await db.execute({
    sql: `INSERT INTO moons (id, campaign_id, slug, name, cycle, domain, description, color, is_goddess, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [newIdVal, campaignId, slug, input.name, input.cycle ?? null, input.domain, input.description, input.color ?? null, input.isGoddess ? 1 : 0, input.sortOrder],
  });
  return newIdVal;
}

export async function adminDeleteMoon(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM moons WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Regions ------------------------------------------------------------

export async function adminGetRegions(campaignId: string): Promise<Region[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT r.*, m.name AS moon_name FROM regions r LEFT JOIN moons m ON m.id = r.moon_id WHERE r.campaign_id = ? ORDER BY r.sort_order ASC, r.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToRegion);
}

export async function adminGetRegion(campaignId: string, id: string): Promise<Region | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT r.*, m.name AS moon_name FROM regions r LEFT JOIN moons m ON m.id = r.moon_id WHERE r.id = ? AND r.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToRegion(r.rows[0]) : null;
}

export interface RegionInput {
  name: string;
  type: string;
  capital?: string;
  government?: string;
  faith?: string;
  moonId?: string | null;
  description: string;
  color?: string;
  sortOrder: number;
  revealed: boolean;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertRegion(campaignId: string, input: RegionInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "regions", input.name, id);
  const regionId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE regions SET name=?, slug=?, type=?, capital=?, government=?, faith=?, moon_id=?, description=?, color=?, sort_order=?, revealed=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.type, input.capital ?? null, input.government ?? null, input.faith ?? null, input.moonId ?? null, input.description, input.color ?? null, input.sortOrder, input.revealed ? 1 : 0, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO regions (id, campaign_id, slug, name, type, capital, government, faith, moon_id, description, color, sort_order, revealed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [regionId, campaignId, slug, input.name, input.type, input.capital ?? null, input.government ?? null, input.faith ?? null, input.moonId ?? null, input.description, input.color ?? null, input.sortOrder, input.revealed ? 1 : 0],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "regions", regionId, input.restrictedPlayerIds);
  }
  return regionId;
}

export async function adminDeleteRegion(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM regions WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Locations ------------------------------------------------------------

export async function adminGetLocations(campaignId: string): Promise<Location[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT l.*, p.name AS parent_name, p.slug AS parent_slug, rg.name AS region_name, rg.slug AS region_slug
     FROM locations l LEFT JOIN locations p ON p.id = l.parent_id LEFT JOIN regions rg ON rg.id = l.region_id
     WHERE l.campaign_id = ?
     ORDER BY l.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToLocation);
}

export async function adminGetLocation(campaignId: string, id: string): Promise<Location | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT l.*, p.name AS parent_name, p.slug AS parent_slug, rg.name AS region_name, rg.slug AS region_slug
          FROM locations l LEFT JOIN locations p ON p.id = l.parent_id LEFT JOIN regions rg ON rg.id = l.region_id
          WHERE l.id = ? AND l.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToLocation(r.rows[0]) : null;
}

export interface LocationInput {
  name: string;
  type: string;
  parentId?: string | null;
  regionId?: string | null;
  description: string;
  thumbnailPath?: string;
  revealed: boolean;
  notes?: string;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertLocation(campaignId: string, input: LocationInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "locations", input.name, id);
  const locationId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE locations SET name=?, slug=?, type=?, parent_id=?, region_id=?, description=?, thumbnail_path=?, revealed=?, notes=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.type, input.parentId ?? null, input.regionId ?? null, input.description, input.thumbnailPath ?? null, input.revealed ? 1 : 0, input.notes ?? null, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO locations (id, campaign_id, slug, name, type, parent_id, region_id, description, thumbnail_path, revealed, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [locationId, campaignId, slug, input.name, input.type, input.parentId ?? null, input.regionId ?? null, input.description, input.thumbnailPath ?? null, input.revealed ? 1 : 0, input.notes ?? null],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "locations", locationId, input.restrictedPlayerIds);
  }
  return locationId;
}

export async function adminDeleteLocation(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM locations WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Characters ------------------------------------------------------------

export async function adminGetCharacters(campaignId: string): Promise<Character[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.*, loc.name AS location_name, loc.slug AS location_slug FROM characters c LEFT JOIN locations loc ON loc.id = c.location_id WHERE c.campaign_id = ? ORDER BY c.is_pc DESC, c.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToCharacter);
}

export async function adminGetCharacter(campaignId: string, id: string): Promise<Character | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.*, loc.name AS location_name, loc.slug AS location_slug FROM characters c LEFT JOIN locations loc ON loc.id = c.location_id WHERE c.id = ? AND c.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToCharacter(r.rows[0]) : null;
}

export interface CharacterInput {
  name: string;
  isPc: boolean;
  isAlive: boolean;
  race?: string;
  charClass?: string;
  status?: string;
  summary: string;
  bio: string;
  tags?: string;
  portraitPath?: string;
  imageFile?: File | null;
  revealed: boolean;
  locationId?: string | null;
  factionIds?: string[];
  restrictedPlayerIds?: string[];
  /** Discord bot bracket word, e.g. "Bramblefoot" for [[Bramblefoot]]:. Empty string/undefined clears it. */
  mask?: string | null;
}

export async function adminUpsertCharacter(campaignId: string, input: CharacterInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "characters", input.name, id);
  const charId = id ?? newId();
  let portraitUrl: string | null | undefined = input.portraitPath ?? undefined;
  if (input.imageFile && input.imageFile.size > 0) {
    portraitUrl = await uploadCharacterPortrait(input.imageFile);
  }
  const mask = input.mask ? input.mask.trim() || null : null;
  if (id) {
    if (portraitUrl !== undefined) {
      await db.execute({
        sql: `UPDATE characters SET name=?, slug=?, is_pc=?, is_alive=?, race=?, char_class=?, status=?, summary=?, bio=?, tags=?, portrait_path=?, revealed=?, location_id=?, mask=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, portraitUrl ?? null, input.revealed ? 1 : 0, input.locationId ?? null, mask, id, campaignId],
      });
    } else {
      await db.execute({
        sql: `UPDATE characters SET name=?, slug=?, is_pc=?, is_alive=?, race=?, char_class=?, status=?, summary=?, bio=?, tags=?, revealed=?, location_id=?, mask=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, input.revealed ? 1 : 0, input.locationId ?? null, mask, id, campaignId],
      });
    }
  } else {
    await db.execute({
      sql: `INSERT INTO characters (id, campaign_id, slug, name, is_pc, is_alive, race, char_class, status, summary, bio, tags, portrait_path, revealed, location_id, mask) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [charId, campaignId, slug, input.name, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, portraitUrl ?? null, input.revealed ? 1 : 0, input.locationId ?? null, mask],
    });
  }
  if (input.factionIds) {
    await db.batch(
      [
        { sql: "DELETE FROM character_factions WHERE character_id = ?", args: [charId] },
        ...input.factionIds.map((factionId) => ({
          sql: "INSERT INTO character_factions (id, character_id, faction_id) VALUES (?,?,?)",
          args: [newId(), charId, factionId],
        })),
      ],
      "write"
    );
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "characters", charId, input.restrictedPlayerIds);
  }
  return charId;
}

export async function adminDeleteCharacter(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM characters WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

export async function adminGetCharacterFactionIds(characterId: string): Promise<string[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT faction_id FROM character_factions WHERE character_id = ?",
    args: [characterId],
  });
  return r.rows.map((row) => row.faction_id as string);
}

// Bulk read for the Campaign Export/Import feature's "characterSheets"
// entity type (see campaign-io/collect.ts) - character_sheets has no
// campaign_id of its own (it's keyed 1:1 off character_id), so this joins
// through characters to scope the read to one campaign, same pattern as
// every other adminGet* here. mergeWithDefaults keeps this symmetric with
// getCharacterSheet's own read path (character-sheet.ts) so a
// partially-filled JSON blob never round-trips through export/import with
// missing keys.
export async function adminGetAllCharacterSheets(
  campaignId: string
): Promise<{ characterId: string; characterName: string; data: CharacterSheetData }[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT cs.character_id, c.name AS character_name, cs.data
          FROM character_sheets cs
          JOIN characters c ON c.id = cs.character_id
          WHERE c.campaign_id = ?`,
    args: [campaignId],
  });
  return r.rows.map((row) => {
    let data: CharacterSheetData;
    try {
      data = mergeWithDefaults(JSON.parse(row.data as string));
    } catch {
      data = mergeWithDefaults({});
    }
    return { characterId: row.character_id as string, characterName: row.character_name as string, data };
  });
}

// ---- Factions ------------------------------------------------------------

export async function adminGetFactions(campaignId: string): Promise<Faction[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT f.*, rg.name AS region_name, rg.slug AS region_slug FROM factions f LEFT JOIN regions rg ON rg.id = f.region_id WHERE f.campaign_id = ? ORDER BY f.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToFaction);
}

export async function adminGetFaction(campaignId: string, id: string): Promise<Faction | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT f.*, rg.name AS region_name, rg.slug AS region_slug FROM factions f LEFT JOIN regions rg ON rg.id = f.region_id WHERE f.id = ? AND f.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToFaction(r.rows[0]) : null;
}

export interface FactionInput {
  name: string;
  type: string;
  regionId?: string | null;
  description: string;
  goals?: string;
  notes?: string;
  revealed: boolean;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertFaction(campaignId: string, input: FactionInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "factions", input.name, id);
  const factionId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE factions SET name=?, slug=?, type=?, region_id=?, description=?, goals=?, notes=?, revealed=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.type, input.regionId ?? null, input.description, input.goals ?? null, input.notes ?? null, input.revealed ? 1 : 0, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO factions (id, campaign_id, slug, name, type, region_id, description, goals, notes, revealed) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [factionId, campaignId, slug, input.name, input.type, input.regionId ?? null, input.description, input.goals ?? null, input.notes ?? null, input.revealed ? 1 : 0],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "factions", factionId, input.restrictedPlayerIds);
  }
  return factionId;
}

export async function adminDeleteFaction(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM factions WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Storylines ------------------------------------------------------------

export async function adminGetStorylines(campaignId: string): Promise<Storyline[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT s.*, loc.name AS location_name, loc.slug AS location_slug FROM storylines s LEFT JOIN locations loc ON loc.id = s.location_id WHERE s.campaign_id = ? ORDER BY s.title ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToStoryline);
}

export async function adminGetStoryline(campaignId: string, id: string): Promise<Storyline | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT s.*, loc.name AS location_name, loc.slug AS location_slug FROM storylines s LEFT JOIN locations loc ON loc.id = s.location_id WHERE s.id = ? AND s.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToStoryline(r.rows[0]) : null;
}

export interface StorylineInput {
  title: string;
  status: string;
  priority?: string;
  summary: string;
  description?: string;
  locationId?: string | null;
  nextStep?: string;
  revealed: boolean;
  characterIds?: string[];
  restrictedPlayerIds?: string[];
}

export async function adminUpsertStoryline(campaignId: string, input: StorylineInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "storylines", input.title, id);
  const storyId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE storylines SET title=?, slug=?, status=?, priority=?, summary=?, description=?, location_id=?, next_step=?, revealed=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.title, slug, input.status, input.priority ?? null, input.summary, input.description ?? null, input.locationId ?? null, input.nextStep ?? null, input.revealed ? 1 : 0, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO storylines (id, campaign_id, slug, title, status, priority, summary, description, location_id, next_step, revealed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [storyId, campaignId, slug, input.title, input.status, input.priority ?? null, input.summary, input.description ?? null, input.locationId ?? null, input.nextStep ?? null, input.revealed ? 1 : 0],
    });
  }
  if (input.characterIds) {
    await db.batch(
      [
        { sql: "DELETE FROM storyline_characters WHERE storyline_id = ?", args: [storyId] },
        ...input.characterIds.map((characterId) => ({
          sql: "INSERT INTO storyline_characters (id, storyline_id, character_id) VALUES (?,?,?)",
          args: [newId(), storyId, characterId],
        })),
      ],
      "write"
    );
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "storylines", storyId, input.restrictedPlayerIds);
  }
  return storyId;
}

export async function adminDeleteStoryline(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM storylines WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

export async function adminGetStorylineCharacterIds(storylineId: string): Promise<string[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT character_id FROM storyline_characters WHERE storyline_id = ?",
    args: [storylineId],
  });
  return r.rows.map((row) => row.character_id as string);
}

// ---- Artifacts ------------------------------------------------------------

export async function adminGetArtifacts(campaignId: string): Promise<Artifact[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT a.*, owner.name AS owner_name, owner.slug AS owner_slug, loc.name AS location_name, loc.slug AS location_slug
     FROM artifacts a LEFT JOIN characters owner ON owner.id = a.owner_character_id LEFT JOIN locations loc ON loc.id = a.location_id
     WHERE a.campaign_id = ?
     ORDER BY a.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToArtifact);
}

export async function adminGetArtifact(campaignId: string, id: string): Promise<Artifact | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT a.*, owner.name AS owner_name, owner.slug AS owner_slug, loc.name AS location_name, loc.slug AS location_slug
          FROM artifacts a LEFT JOIN characters owner ON owner.id = a.owner_character_id LEFT JOIN locations loc ON loc.id = a.location_id
          WHERE a.id = ? AND a.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToArtifact(r.rows[0]) : null;
}

export interface ArtifactInput {
  name: string;
  type: string;
  rarity?: string;
  attunement: boolean;
  ownerCharacterId?: string | null;
  locationId?: string | null;
  description: string;
  mechanics?: string;
  imagePath?: string;
  revealed: boolean;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertArtifact(campaignId: string, input: ArtifactInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "artifacts", input.name, id);
  const artifactId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE artifacts SET name=?, slug=?, type=?, rarity=?, attunement=?, owner_character_id=?, location_id=?, description=?, mechanics=?, image_path=?, revealed=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.type, input.rarity ?? null, input.attunement ? 1 : 0, input.ownerCharacterId ?? null, input.locationId ?? null, input.description, input.mechanics ?? null, input.imagePath ?? null, input.revealed ? 1 : 0, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO artifacts (id, campaign_id, slug, name, type, rarity, attunement, owner_character_id, location_id, description, mechanics, image_path, revealed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [artifactId, campaignId, slug, input.name, input.type, input.rarity ?? null, input.attunement ? 1 : 0, input.ownerCharacterId ?? null, input.locationId ?? null, input.description, input.mechanics ?? null, input.imagePath ?? null, input.revealed ? 1 : 0],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "artifacts", artifactId, input.restrictedPlayerIds);
  }
  return artifactId;
}

export async function adminDeleteArtifact(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM artifacts WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Timeline events --------------------------------------------------------

export async function adminGetTimelineEvents(campaignId: string): Promise<TimelineEvent[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT t.*, loc.name AS location_name, loc.slug AS location_slug FROM timeline_events t LEFT JOIN locations loc ON loc.id = t.location_id WHERE t.campaign_id = ? ORDER BY t.sort_index ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToTimelineEvent);
}

export async function adminGetTimelineEvent(campaignId: string, id: string): Promise<TimelineEvent | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT t.*, loc.name AS location_name, loc.slug AS location_slug FROM timeline_events t LEFT JOIN locations loc ON loc.id = t.location_id WHERE t.id = ? AND t.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToTimelineEvent(r.rows[0]) : null;
}

export interface TimelineEventInput {
  title: string;
  description: string;
  inWorldDate?: string;
  sortIndex: number;
  sessionNumber?: number;
  eventType: string;
  locationId?: string | null;
  storylineId?: string | null;
  revealed: boolean;
  characterIds?: string[];
  restrictedPlayerIds?: string[];
}

export async function adminUpsertTimelineEvent(campaignId: string, input: TimelineEventInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const eventId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE timeline_events SET title=?, description=?, in_world_date=?, sort_index=?, session_number=?, event_type=?, location_id=?, storyline_id=?, revealed=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.title, input.description, input.inWorldDate ?? null, input.sortIndex, input.sessionNumber ?? null, input.eventType, input.locationId ?? null, input.storylineId ?? null, input.revealed ? 1 : 0, id, campaignId],
    });
  } else {
    await assertCreateQuota(campaignId, "articles");
    await db.execute({
      sql: `INSERT INTO timeline_events (id, campaign_id, title, description, in_world_date, sort_index, session_number, event_type, location_id, storyline_id, revealed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [eventId, campaignId, input.title, input.description, input.inWorldDate ?? null, input.sortIndex, input.sessionNumber ?? null, input.eventType, input.locationId ?? null, input.storylineId ?? null, input.revealed ? 1 : 0],
    });
  }
  if (input.characterIds) {
    await db.batch(
      [
        { sql: "DELETE FROM timeline_event_characters WHERE event_id = ?", args: [eventId] },
        ...input.characterIds.map((characterId) => ({
          sql: "INSERT INTO timeline_event_characters (id, event_id, character_id) VALUES (?,?,?)",
          args: [newId(), eventId, characterId],
        })),
      ],
      "write"
    );
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "timeline_events", eventId, input.restrictedPlayerIds);
  }
  return eventId;
}

export async function adminDeleteTimelineEvent(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM timeline_events WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

export async function adminGetTimelineEventCharacterIds(eventId: string): Promise<string[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT character_id FROM timeline_event_characters WHERE event_id = ?",
    args: [eventId],
  });
  return r.rows.map((row) => row.character_id as string);
}

// ---- Players ------------------------------------------------------------

function rowToPlayer(row: any): Player {
  return {
    id: row.id,
    campaignId: row.campaign_id ?? null,
    username: row.username,
    displayName: row.display_name,
    characterId: row.character_id ?? null,
    characterName: row.character_name ?? null,
    characterSlug: row.character_slug ?? null,
    discordUserId: row.discord_user_id ?? null,
  };
}

export async function adminGetPlayers(campaignId: string): Promise<Player[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.*, c.name AS character_name, c.slug AS character_slug
     FROM players p LEFT JOIN characters c ON c.id = p.character_id
     WHERE p.campaign_id = ?
     ORDER BY p.display_name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToPlayer);
}

export async function adminGetPlayer(campaignId: string, id: string): Promise<Player | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.*, c.name AS character_name, c.slug AS character_slug
          FROM players p LEFT JOIN characters c ON c.id = p.character_id
          WHERE p.id = ? AND p.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToPlayer(r.rows[0]) : null;
}

export interface PlayerInput {
  username: string;
  displayName: string;
  characterId?: string | null;
  password?: string;
}

export async function adminUpsertPlayer(campaignId: string, input: PlayerInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  if (id) {
    if (input.password) {
      await db.execute({
        sql: `UPDATE players SET username=?, display_name=?, character_id=?, password_hash=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.username, input.displayName, input.characterId ?? null, hashPassword(input.password), id, campaignId],
      });
    } else {
      await db.execute({
        sql: `UPDATE players SET username=?, display_name=?, character_id=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.username, input.displayName, input.characterId ?? null, id, campaignId],
      });
    }
    return id;
  }
  if (!input.password) throw new Error("Password is required when creating a new player account.");
  await assertCreateQuota(campaignId, "players");
  // Players belong to the campaign's owning DM (license system) - usernames
  // are unique within that DM's namespace, enforced by UNIQUE(dm_id, username).
  const dmR = await db.execute({ sql: "SELECT dm_id FROM campaigns WHERE id = ?", args: [campaignId] });
  const dmId = (dmR.rows[0]?.dm_id as string) ?? LEGACY_DM_ID;
  const newIdVal = newId();
  await db.execute({
    sql: `INSERT INTO players (id, dm_id, campaign_id, username, password_hash, display_name, character_id) VALUES (?,?,?,?,?,?,?)`,
    args: [newIdVal, dmId, campaignId, input.username, hashPassword(input.password), input.displayName, input.characterId ?? null],
  });
  return newIdVal;
}

/** Players who self-registered via this DM's /join link and are not yet in
 *  any campaign. Shown on /admin/players with an assign button. */
export async function adminGetUnassignedPlayers(dmId: string): Promise<Player[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.*, NULL AS character_name, NULL AS character_slug
          FROM players p WHERE p.dm_id = ? AND p.campaign_id IS NULL
          ORDER BY p.created_at ASC`,
    args: [dmId],
  });
  return r.rows.map(rowToPlayer);
}

/** Puts a self-registered player into one of the DM's campaigns, enforcing
 *  the per-campaign player quota. */
export async function adminAssignPlayerToCampaign(dmId: string, playerId: string, campaignId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const owned = await db.execute({ sql: "SELECT id FROM campaigns WHERE id = ? AND dm_id = ?", args: [campaignId, dmId] });
  if (!owned.rows[0]) return;
  await assertCreateQuota(campaignId, "players");
  await db.execute({
    sql: "UPDATE players SET campaign_id = ?, updated_at = datetime('now') WHERE id = ? AND dm_id = ?",
    args: [campaignId, playerId, dmId],
  });
}

export async function adminDeletePlayer(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM players WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---- Maps ------------------------------------------------------------

export async function adminGetMaps(campaignId: string): Promise<MapEntity[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT m.*, l.name AS location_name, l.slug AS location_slug
     FROM maps m LEFT JOIN locations l ON l.id = m.location_id
     WHERE m.campaign_id = ?
     ORDER BY m.sort_order ASC, m.name ASC`,
    args: [campaignId],
  });
  return r.rows.map(rowToMap);
}

export async function adminGetMap(campaignId: string, id: string): Promise<MapEntity | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT m.*, l.name AS location_name, l.slug AS location_slug
          FROM maps m LEFT JOIN locations l ON l.id = m.location_id
          WHERE m.id = ? AND m.campaign_id = ?`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToMap(r.rows[0]) : null;
}

export interface MapInput {
  name: string;
  locationId?: string | null;
  isRoot: boolean;
  revealed: boolean;
  sortOrder: number;
  imageFile?: File | null;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertMap(campaignId: string, input: MapInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "maps", input.name, id);
  const mapId = id ?? newId();

  let imageUrl: string | null = null;
  if (input.imageFile && input.imageFile.size > 0) {
    imageUrl = await uploadMapImage(input.imageFile);
  }

  if (id) {
    if (imageUrl) {
      await db.execute({
        sql: `UPDATE maps SET name=?, slug=?, location_id=?, is_root=?, revealed=?, sort_order=?, image_url=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.locationId ?? null, input.isRoot ? 1 : 0, input.revealed ? 1 : 0, input.sortOrder, imageUrl, id, campaignId],
      });
    } else {
      await db.execute({
        sql: `UPDATE maps SET name=?, slug=?, location_id=?, is_root=?, revealed=?, sort_order=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.locationId ?? null, input.isRoot ? 1 : 0, input.revealed ? 1 : 0, input.sortOrder, id, campaignId],
      });
    }
  } else {
    if (!imageUrl) throw new Error("A map image is required when creating a new map.");
    await db.execute({
      sql: `INSERT INTO maps (id, campaign_id, slug, name, image_url, location_id, is_root, revealed, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [mapId, campaignId, slug, input.name, imageUrl, input.locationId ?? null, input.isRoot ? 1 : 0, input.revealed ? 1 : 0, input.sortOrder],
    });
  }

  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "maps", mapId, input.restrictedPlayerIds);
  }

  return mapId;
}

export async function adminDeleteMap(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM maps WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

export async function adminGetMapPins(mapId: string): Promise<MapPin[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.*, t.slug AS target_map_slug, t.name AS target_map_name
          FROM map_pins p LEFT JOIN maps t ON t.id = p.target_map_id
          WHERE p.map_id = ?`,
    args: [mapId],
  });
  return r.rows.map(rowToMapPin);
}

export interface MapPinInput {
  x: number;
  y: number;
  label?: string | null;
  icon?: string | null;
  targetMapId?: string | null;
}

export async function adminCreateMapPin(mapId: string, input: MapPinInput): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const pinId = newId();
  await db.execute({
    sql: `INSERT INTO map_pins (id, map_id, x, y, label, icon, target_map_id) VALUES (?,?,?,?,?,?,?)`,
    args: [pinId, mapId, input.x, input.y, input.label ?? null, input.icon ?? null, input.targetMapId ?? null],
  });
  return pinId;
}

export async function adminUpdateMapPin(pinId: string, input: MapPinInput): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE map_pins SET x=?, y=?, label=?, icon=?, target_map_id=?, updated_at=datetime('now') WHERE id=?`,
    args: [input.x, input.y, input.label ?? null, input.icon ?? null, input.targetMapId ?? null, pinId],
  });
}

export async function adminDeleteMapPin(pinId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM map_pins WHERE id = ?", args: [pinId] });
}

// ---- Map Regions (character token auto-placement) --------------------------

export async function adminGetMapRegions(mapId: string): Promise<MapRegion[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT r.*, l.name AS location_name FROM map_regions r
          LEFT JOIN locations l ON l.id = r.location_id
          WHERE r.map_id = ?`,
    args: [mapId],
  });
  return r.rows.map(rowToMapRegion);
}

export interface MapRegionInput {
  locationId: string;
  points: MapRegionPoint[];
}

export async function adminCreateMapRegion(mapId: string, input: MapRegionInput): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const id = newId();
  await db.execute({
    sql: `INSERT INTO map_regions (id, map_id, location_id, points) VALUES (?,?,?,?)`,
    args: [id, mapId, input.locationId, JSON.stringify(input.points)],
  });
  return id;
}

export async function adminUpdateMapRegion(regionId: string, input: MapRegionInput): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE map_regions SET location_id=?, points=?, updated_at=datetime('now') WHERE id=?`,
    args: [input.locationId, JSON.stringify(input.points), regionId],
  });
}

export async function adminDeleteMapRegion(regionId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM map_regions WHERE id = ?", args: [regionId] });
}

// ---- Character map tokens (admin editor: every character, auto-placed via
// regions or manually dragged; see resolveCharacterAnchor in queries.ts) ----

export async function adminGetCharacterMapTokens(campaignId: string, mapId: string): Promise<AdminCharacterMapToken[]> {
  await ensureSchema();
  const db = getDb();

  const charsResult = await db.execute({
    sql: `SELECT id, name, portrait_path, location_id FROM characters WHERE campaign_id = ? AND location_id IS NOT NULL`,
    args: [campaignId],
  });
  if (charsResult.rows.length === 0) return [];

  const locResult = await db.execute({
    sql: "SELECT id, parent_id FROM locations WHERE campaign_id = ?",
    args: [campaignId],
  });
  const parentOf = new Map<string, string | null>();
  for (const row of locResult.rows) parentOf.set(row.id as string, (row.parent_id as string) ?? null);

  const regionsResult = await db.execute({ sql: "SELECT * FROM map_regions WHERE map_id = ?", args: [mapId] });
  const regionsByLocation = new Map<string, RegionAnchor>();
  for (const row of regionsResult.rows) {
    if (!regionsByLocation.has(row.location_id as string)) {
      regionsByLocation.set(row.location_id as string, polygonCentroid(parseRegionPoints(row.points)));
    }
  }

  const overridesResult = await db.execute({
    sql: "SELECT * FROM character_map_positions WHERE map_id = ?",
    args: [mapId],
  });
  const overridesByCharacter = new Map<string, { x: number; y: number }>();
  const overriddenIds = new Set<string>();
  for (const row of overridesResult.rows) {
    overridesByCharacter.set(row.character_id as string, { x: Number(row.x), y: Number(row.y) });
    overriddenIds.add(row.character_id as string);
  }

  return charsResult.rows.map((row) => {
    const characterId = row.id as string;
    const locationId = (row.location_id as string) ?? null;
    const anchor = resolveCharacterAnchor(characterId, locationId, regionsByLocation, overridesByCharacter, parentOf);
    return {
      characterId,
      name: row.name as string,
      portraitPath: (row.portrait_path as string) ?? null,
      x: anchor?.x ?? null,
      y: anchor?.y ?? null,
      isOverride: overriddenIds.has(characterId),
    };
  });
}

export async function adminSetCharacterMapPosition(mapId: string, characterId: string, x: number, y: number): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT id FROM character_map_positions WHERE map_id = ? AND character_id = ?",
    args: [mapId, characterId],
  });
  if (existing.rows[0]) {
    await db.execute({
      sql: "UPDATE character_map_positions SET x = ?, y = ?, updated_at = datetime('now') WHERE map_id = ? AND character_id = ?",
      args: [x, y, mapId, characterId],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO character_map_positions (id, map_id, character_id, x, y) VALUES (?,?,?,?,?)",
      args: [newId(), mapId, characterId, x, y],
    });
  }
}

export async function adminClearCharacterMapPosition(mapId: string, characterId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM character_map_positions WHERE map_id = ? AND character_id = ?",
    args: [mapId, characterId],
  });
}

// ---------------------------------------------------------------------------
// Sections (Phase 1 of the "Section Creator" - see types.ts for the design
// note). A Section is a custom player-facing page made of one or more
// Article Lists, each curating an ordered set of ids from ONE existing
// built-in entity table. No new content types are created here - Phase 2
// will add a template system for genuinely custom article shapes.
// ---------------------------------------------------------------------------

export async function adminGetSections(campaignId: string): Promise<Section[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM sections WHERE campaign_id = ? ORDER BY sort_order ASC, name ASC",
    args: [campaignId],
  });
  return r.rows.map(rowToSection);
}

export async function adminGetSection(campaignId: string, id: string): Promise<Section | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM sections WHERE id = ? AND campaign_id = ?",
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToSection(r.rows[0]) : null;
}

export interface SectionInput {
  name: string;
  revealed: boolean;
  sortOrder: number;
  restrictedPlayerIds?: string[];
}

export async function adminUpsertSection(campaignId: string, input: SectionInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(campaignId, "sections", input.name, id);
  const sectionId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE sections SET name=?, slug=?, revealed=?, sort_order=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [input.name, slug, input.revealed ? 1 : 0, input.sortOrder, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO sections (id, campaign_id, slug, name, revealed, sort_order) VALUES (?,?,?,?,?,?)`,
      args: [sectionId, campaignId, slug, input.name, input.revealed ? 1 : 0, input.sortOrder],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "sections", sectionId, input.restrictedPlayerIds);
  }
  return sectionId;
}

export async function adminDeleteSection(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM sections WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// Human labels for the "+ Add List" entity-type picker. Only the six
// built-in types have a fixed label here - "custom" lists show the
// template's own name instead (see templateName on AdminArticleList).
export const SECTION_ENTITY_TYPE_LABELS: Record<Exclude<SectionEntityType, "custom">, string> = {
  characters: "Characters",
  locations: "Locations",
  factions: "Factions",
  storylines: "Storylines",
  artifacts: "Artifacts",
  regions: "Regions",
};

// {id, label} options for whichever built-in type a list holds - used both
// to populate the "+ Add [type]" picker (minus ids already in the list) and
// nowhere else, so it deliberately returns every row in the campaign
// regardless of revealed - the DM should be able to add hidden content to a
// list ahead of revealing it.
export async function adminGetEntityOptions(
  campaignId: string,
  entityType: Exclude<SectionEntityType, "custom">
): Promise<{ id: string; label: string }[]> {
  switch (entityType) {
    case "characters":
      return (await adminGetCharacters(campaignId)).map((c) => ({ id: c.id, label: c.name }));
    case "locations":
      return (await adminGetLocations(campaignId)).map((l) => ({ id: l.id, label: l.name }));
    case "factions":
      return (await adminGetFactions(campaignId)).map((f) => ({ id: f.id, label: f.name }));
    case "storylines":
      return (await adminGetStorylines(campaignId)).map((s) => ({ id: s.id, label: s.title }));
    case "artifacts":
      return (await adminGetArtifacts(campaignId)).map((a) => ({ id: a.id, label: a.name }));
    case "regions":
      return (await adminGetRegions(campaignId)).map((r) => ({ id: r.id, label: r.name }));
  }
}

/** {id, label} options for an existing Template's articles in this campaign - the custom-list analogue of adminGetEntityOptions. */
export async function adminGetArticleOptions(campaignId: string, templateId: string): Promise<{ id: string; label: string }[]> {
  await ensureSchema();
  const template = await getTemplateWithFields(templateId);
  const titleField = template?.fields.find((f) => f.role === "title");
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT * FROM articles WHERE campaign_id = ? AND template_id = ?",
    args: [campaignId, templateId],
  });
  return r.rows.map((row) => {
    const article = rowToArticle(row);
    const label = titleField ? String(article.data[titleField.key] ?? "(untitled)") : "(untitled)";
    return { id: article.id, label };
  });
}

export async function adminGetArticleLists(campaignId: string, sectionId: string): Promise<AdminArticleList[]> {
  await ensureSchema();
  const db = getDb();
  const listsResult = await db.execute({
    sql: "SELECT al.*, t.name AS template_name FROM article_lists al LEFT JOIN templates t ON t.id = al.template_id WHERE al.section_id = ? ORDER BY al.sort_order ASC",
    args: [sectionId],
  });
  const lists: AdminArticleList[] = [];
  for (const row of listsResult.rows) {
    const entityType = row.entity_type as SectionEntityType;
    const templateId = (row.template_id as string) ?? null;
    const options =
      entityType === "custom" && templateId
        ? await adminGetArticleOptions(campaignId, templateId)
        : await adminGetEntityOptions(campaignId, entityType as Exclude<SectionEntityType, "custom">);
    const titleById = new Map(options.map((o) => [o.id, o.label]));
    const itemsResult = await db.execute({
      sql: "SELECT * FROM article_list_items WHERE list_id = ? ORDER BY sort_order ASC",
      args: [row.id as string],
    });
    const items = itemsResult.rows.map((itemRow) => ({
      id: itemRow.id as string,
      entityId: itemRow.entity_id as string,
      title: titleById.get(itemRow.entity_id as string) ?? "(deleted)",
      sortOrder: Number(itemRow.sort_order ?? 0),
    }));
    lists.push({
      id: row.id as string,
      sectionId: row.section_id as string,
      entityType,
      templateId,
      templateName: (row.template_name as string) ?? null,
      name: row.name as string,
      sortOrder: Number(row.sort_order ?? 0),
      items,
    });
  }
  return lists;
}

export interface ArticleListInput {
  entityType: SectionEntityType;
  templateId?: string | null;
  name: string;
}

export async function adminCreateArticleList(sectionId: string, input: ArticleListInput): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM article_lists WHERE section_id = ?",
    args: [sectionId],
  });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  const id = newId();
  await db.execute({
    sql: "INSERT INTO article_lists (id, section_id, entity_type, template_id, name, sort_order) VALUES (?,?,?,?,?,?)",
    args: [id, sectionId, input.entityType, input.entityType === "custom" ? input.templateId ?? null : null, input.name, nextOrder],
  });
  return id;
}

export async function adminRenameArticleList(listId: string, name: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE article_lists SET name=?, updated_at=datetime('now') WHERE id=?",
    args: [name, listId],
  });
}

export async function adminDeleteArticleList(listId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM article_lists WHERE id = ?", args: [listId] });
}

/** Swaps this list's sort_order with its neighbor in the given direction, scoped to its own section. */
export async function adminMoveArticleList(sectionId: string, listId: string, direction: "up" | "down"): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT id, sort_order FROM article_lists WHERE section_id = ? ORDER BY sort_order ASC",
    args: [sectionId],
  });
  const rows = r.rows.map((row) => ({ id: row.id as string, sortOrder: Number(row.sort_order ?? 0) }));
  const index = rows.findIndex((row) => row.id === listId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await db.batch(
    [
      { sql: "UPDATE article_lists SET sort_order = ? WHERE id = ?", args: [b.sortOrder, a.id] },
      { sql: "UPDATE article_lists SET sort_order = ? WHERE id = ?", args: [a.sortOrder, b.id] },
    ],
    "write"
  );
}

export async function adminAddArticleListItem(listId: string, entityId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM article_list_items WHERE list_id = ?",
    args: [listId],
  });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  await db.execute({
    sql: "INSERT OR IGNORE INTO article_list_items (id, list_id, entity_id, sort_order) VALUES (?,?,?,?)",
    args: [newId(), listId, entityId, nextOrder],
  });
}

export async function adminRemoveArticleListItem(itemId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM article_list_items WHERE id = ?", args: [itemId] });
}

/** Swaps this item's sort_order with its neighbor in the given direction, scoped to its own list. */
export async function adminMoveArticleListItem(listId: string, itemId: string, direction: "up" | "down"): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT id, sort_order FROM article_list_items WHERE list_id = ? ORDER BY sort_order ASC",
    args: [listId],
  });
  const rows = r.rows.map((row) => ({ id: row.id as string, sortOrder: Number(row.sort_order ?? 0) }));
  const index = rows.findIndex((row) => row.id === itemId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await db.batch(
    [
      { sql: "UPDATE article_list_items SET sort_order = ? WHERE id = ?", args: [b.sortOrder, a.id] },
      { sql: "UPDATE article_list_items SET sort_order = ? WHERE id = ?", args: [a.sortOrder, b.id] },
    ],
    "write"
  );
}

// ---------------------------------------------------------------------------
// Templates (Phase 2 of the "Section Creator"). Deliberately global - no
// campaignId parameter anywhere in this block, unlike every other admin
// query in this file. See the design note on the `templates` table in
// schema.sql and [[project_erendyl_sections_phase2_templates]] for why.
// ---------------------------------------------------------------------------

export interface AdminTemplateSummary extends Template {
  fieldCount: number;
  articleCount: number;
}

export async function adminGetTemplates(): Promise<AdminTemplateSummary[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute(
    `SELECT t.*,
            (SELECT COUNT(*) FROM template_fields tf WHERE tf.template_id = t.id) AS field_count,
            (SELECT COUNT(*) FROM articles a WHERE a.template_id = t.id) AS article_count
     FROM templates t
     ORDER BY t.name ASC`
  );
  return r.rows.map((row) => ({
    ...rowToTemplate(row),
    fieldCount: Number(row.field_count ?? 0),
    articleCount: Number(row.article_count ?? 0),
  }));
}

export async function adminGetTemplate(id: string): Promise<TemplateWithFields | null> {
  return getTemplateWithFields(id);
}

export interface TemplateInput {
  name: string;
  description?: string | null;
}

export async function adminUpsertTemplate(input: TemplateInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueGlobalSlug("templates", input.name, id);
  if (id) {
    await db.execute({
      sql: `UPDATE templates SET name=?, slug=?, description=?, updated_at=datetime('now') WHERE id=?`,
      args: [input.name, slug, input.description ?? null, id],
    });
    return id;
  }
  const newIdVal = newId();
  await db.execute({
    sql: `INSERT INTO templates (id, slug, name, description) VALUES (?,?,?,?)`,
    args: [newIdVal, slug, input.name, input.description ?? null],
  });
  return newIdVal;
}

/**
 * Deletes a template UNLESS any article, in any campaign, still uses it -
 * since the template is global, deleting it out from under existing
 * articles would silently break content in every campaign at once, not
 * just the one the DM currently has selected. Returns the number of
 * articles blocking the delete (0 means it succeeded).
 */
export async function adminDeleteTemplate(id: string): Promise<{ deleted: boolean; articleCount: number }> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({ sql: "SELECT COUNT(*) AS c FROM articles WHERE template_id = ?", args: [id] });
  const articleCount = Number(r.rows[0]?.c ?? 0);
  if (articleCount > 0) return { deleted: false, articleCount };
  await db.execute({ sql: "DELETE FROM templates WHERE id = ?", args: [id] });
  return { deleted: true, articleCount: 0 };
}

export interface TemplateFieldInput {
  label: string;
  fieldType: TemplateFieldType;
  role?: TemplateFieldRole | null;
  // Only meaningful when fieldType === "reference" - see the design note on
  // TemplateField in types.ts.
  referenceTargetType?: SectionEntityType | null;
  referenceTemplateId?: string | null;
  referenceMultiple?: boolean;
}

/** If the new/edited field claims role "title", clears that role off every other field in the template first (at most one title field per template). */
async function clearOtherTitleRoles(templateId: string, excludeFieldId?: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE template_fields SET role = NULL WHERE template_id = ? AND role = 'title' ${excludeFieldId ? "AND id != ?" : ""}`,
    args: excludeFieldId ? [templateId, excludeFieldId] : [templateId],
  });
}

export async function adminCreateTemplateField(templateId: string, input: TemplateFieldInput): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const key = input.fieldType === "heading" ? await uniqueFieldKey(templateId, `heading_${newId().slice(0, 8)}`) : await uniqueFieldKey(templateId, input.label);
  const existing = await db.execute({
    sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM template_fields WHERE template_id = ?",
    args: [templateId],
  });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  const id = newId();
  if (input.role === "title") await clearOtherTitleRoles(templateId);
  const isReference = input.fieldType === "reference";
  await db.execute({
    sql: "INSERT INTO template_fields (id, template_id, key, label, field_type, role, reference_target_type, reference_template_id, reference_multiple, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)",
    args: [
      id,
      templateId,
      key,
      input.label,
      input.fieldType,
      input.role ?? null,
      isReference ? input.referenceTargetType ?? null : null,
      isReference && input.referenceTargetType === "custom" ? input.referenceTemplateId ?? null : null,
      isReference && input.referenceMultiple ? 1 : 0,
      nextOrder,
    ],
  });
  return id;
}

/** Updates a field's label/type/role/reference-target. The machine `key` is intentionally immutable once created - existing articles' data blobs are already keyed by it. */
export async function adminUpdateTemplateField(templateId: string, fieldId: string, input: TemplateFieldInput): Promise<void> {
  await ensureSchema();
  const db = getDb();
  if (input.role === "title") await clearOtherTitleRoles(templateId, fieldId);
  const isReference = input.fieldType === "reference";
  await db.execute({
    sql: "UPDATE template_fields SET label=?, field_type=?, role=?, reference_target_type=?, reference_template_id=?, reference_multiple=? WHERE id=? AND template_id=?",
    args: [
      input.label,
      input.fieldType,
      input.role ?? null,
      isReference ? input.referenceTargetType ?? null : null,
      isReference && input.referenceTargetType === "custom" ? input.referenceTemplateId ?? null : null,
      isReference && input.referenceMultiple ? 1 : 0,
      fieldId,
      templateId,
    ],
  });
}

/**
 * {id, label} options for whatever a reference field targets - the
 * reference-field analogue of adminGetEntityOptions/adminGetArticleOptions,
 * used to populate the admin article form's picker for a 'reference' field.
 */
export async function adminGetReferenceOptions(campaignId: string, field: TemplateField): Promise<{ id: string; label: string }[]> {
  if (!field.referenceTargetType) return [];
  if (field.referenceTargetType === "custom") {
    if (!field.referenceTemplateId) return [];
    return adminGetArticleOptions(campaignId, field.referenceTemplateId);
  }
  return adminGetEntityOptions(campaignId, field.referenceTargetType);
}

export async function adminDeleteTemplateField(fieldId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM template_fields WHERE id = ?", args: [fieldId] });
}

/** Swaps this field's sort_order with its neighbor in the given direction, scoped to its own template. */
export async function adminMoveTemplateField(templateId: string, fieldId: string, direction: "up" | "down"): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT id, sort_order FROM template_fields WHERE template_id = ? ORDER BY sort_order ASC",
    args: [templateId],
  });
  const rows = r.rows.map((row) => ({ id: row.id as string, sortOrder: Number(row.sort_order ?? 0) }));
  const index = rows.findIndex((row) => row.id === fieldId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await db.batch(
    [
      { sql: "UPDATE template_fields SET sort_order = ? WHERE id = ?", args: [b.sortOrder, a.id] },
      { sql: "UPDATE template_fields SET sort_order = ? WHERE id = ?", args: [a.sortOrder, b.id] },
    ],
    "write"
  );
}

// ---------------------------------------------------------------------------
// Articles: campaign-scoped instances of a (global) Template. See the design
// note on the `articles` table in schema.sql.
// ---------------------------------------------------------------------------

export async function adminGetArticle(campaignId: string, id: string): Promise<Article | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM articles WHERE id = ? AND campaign_id = ?",
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToArticle(r.rows[0]) : null;
}

export interface ArticleInput {
  data: ArticleData;
  revealed: boolean;
  restrictedPlayerIds?: string[];
}

/** Creates or updates an article. The slug is derived from the template's title-role field value, same pattern as every other entity's name/title-derived slug. */
export async function adminUpsertArticle(
  campaignId: string,
  templateId: string,
  input: ArticleInput,
  id?: string
): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const template = await getTemplateWithFields(templateId);
  const titleField = template?.fields.find((f) => f.role === "title");
  const titleValue = titleField ? String(input.data[titleField.key] ?? "untitled") : "untitled";
  const slug = await uniqueSlug(campaignId, "articles", titleValue, id);
  const dataJson = JSON.stringify(input.data);
  const articleId = id ?? newId();
  if (id) {
    await db.execute({
      sql: `UPDATE articles SET slug=?, revealed=?, data=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
      args: [slug, input.revealed ? 1 : 0, dataJson, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO articles (id, campaign_id, template_id, slug, revealed, data) VALUES (?,?,?,?,?,?)`,
      args: [articleId, campaignId, templateId, slug, input.revealed ? 1 : 0, dataJson],
    });
  }
  if (input.restrictedPlayerIds !== undefined) {
    await adminSetRestrictedPlayerIds(campaignId, "articles", articleId, input.restrictedPlayerIds);
  }
  if (template) await syncArticleReferences(articleId, template.fields, input.data);
  return articleId;
}

/**
 * Rebuilds article_references for one article from scratch, to match
 * whatever its 'reference' fields currently hold - called on every
 * adminUpsertArticle so the "Referenced By" backlink index (see
 * getBacklinksForEntity in queries.ts) never drifts from the article's own
 * data blob. Cheap at this app's scale (a handful of reference fields per
 * template, a handful of ids per field) and much simpler than trying to
 * diff old vs. new values field-by-field.
 */
async function syncArticleReferences(articleId: string, fields: TemplateField[], data: ArticleData): Promise<void> {
  const db = getDb();
  // Collect every INSERT first, then ship the DELETE + INSERTs as one atomic
  // batch (one round trip, instead of 1 + one per reference id).
  const inserts: { sql: string; args: (string | null)[] }[] = [];
  for (const field of fields) {
    if (field.fieldType !== "reference" || !field.referenceTargetType) continue;
    const raw = data[field.key];
    const ids = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const targetId of ids) {
      if (!targetId) continue;
      inserts.push({
        sql: "INSERT INTO article_references (id, article_id, field_id, target_type, target_id) VALUES (?,?,?,?,?)",
        args: [newId(), articleId, field.id, field.referenceTargetType, targetId],
      });
    }
  }
  await db.batch(
    [{ sql: "DELETE FROM article_references WHERE article_id = ?", args: [articleId] }, ...inserts],
    "write"
  );
}

export async function adminDeleteArticle(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  // article_list_items.entity_id has no FK (it can point into six different
  // tables plus this one), so any list membership referencing this article
  // is left in place and simply resolves to nothing at render time - same
  // pattern as every other entity type's delete (see attachListsToSections
  // in queries.ts).
  await getDb().execute({ sql: "DELETE FROM articles WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}
