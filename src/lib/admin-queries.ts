import { getDb, ensureSchema, newId } from "./db";
import { slugify } from "./slug";
import { hashPassword } from "./password";
import { uploadMapImage, uploadCharacterPortrait } from "./blob-storage";
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
]);
const DELETABLE_TABLES = new Set([...REVEALABLE_TABLES, "moons", "players"]);

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
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
  await db.execute({
    sql: "DELETE FROM entity_player_access WHERE entity_type = ? AND entity_id = ?",
    args: [entityType, entityId],
  });
  for (const playerId of playerIds) {
    await db.execute({
      sql: "INSERT INTO entity_player_access (id, campaign_id, entity_type, entity_id, player_id) VALUES (?,?,?,?,?)",
      args: [newId(), campaignId, entityType, entityId, playerId],
    });
  }
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
  if (id) {
    if (portraitUrl !== undefined) {
      await db.execute({
        sql: `UPDATE characters SET name=?, slug=?, is_pc=?, is_alive=?, race=?, char_class=?, status=?, summary=?, bio=?, tags=?, portrait_path=?, revealed=?, location_id=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, portraitUrl ?? null, input.revealed ? 1 : 0, input.locationId ?? null, id, campaignId],
      });
    } else {
      await db.execute({
        sql: `UPDATE characters SET name=?, slug=?, is_pc=?, is_alive=?, race=?, char_class=?, status=?, summary=?, bio=?, tags=?, revealed=?, location_id=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?`,
        args: [input.name, slug, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, input.revealed ? 1 : 0, input.locationId ?? null, id, campaignId],
      });
    }
  } else {
    await db.execute({
      sql: `INSERT INTO characters (id, campaign_id, slug, name, is_pc, is_alive, race, char_class, status, summary, bio, tags, portrait_path, revealed, location_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [charId, campaignId, slug, input.name, input.isPc ? 1 : 0, input.isAlive ? 1 : 0, input.race ?? null, input.charClass ?? null, input.status ?? null, input.summary, input.bio, input.tags ?? null, portraitUrl ?? null, input.revealed ? 1 : 0, input.locationId ?? null],
    });
  }
  if (input.factionIds) {
    await db.execute({ sql: "DELETE FROM character_factions WHERE character_id = ?", args: [charId] });
    for (const factionId of input.factionIds) {
      await db.execute({
        sql: "INSERT INTO character_factions (id, character_id, faction_id) VALUES (?,?,?)",
        args: [newId(), charId, factionId],
      });
    }
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
    await db.execute({ sql: "DELETE FROM storyline_characters WHERE storyline_id = ?", args: [storyId] });
    for (const characterId of input.characterIds) {
      await db.execute({
        sql: "INSERT INTO storyline_characters (id, storyline_id, character_id) VALUES (?,?,?)",
        args: [newId(), storyId, characterId],
      });
    }
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
    await db.execute({
      sql: `INSERT INTO timeline_events (id, campaign_id, title, description, in_world_date, sort_index, session_number, event_type, location_id, storyline_id, revealed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [eventId, campaignId, input.title, input.description, input.inWorldDate ?? null, input.sortIndex, input.sessionNumber ?? null, input.eventType, input.locationId ?? null, input.storylineId ?? null, input.revealed ? 1 : 0],
    });
  }
  if (input.characterIds) {
    await db.execute({ sql: "DELETE FROM timeline_event_characters WHERE event_id = ?", args: [eventId] });
    for (const characterId of input.characterIds) {
      await db.execute({
        sql: "INSERT INTO timeline_event_characters (id, event_id, character_id) VALUES (?,?,?)",
        args: [newId(), eventId, characterId],
      });
    }
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
    username: row.username,
    displayName: row.display_name,
    characterId: row.character_id ?? null,
    characterName: row.character_name ?? null,
    characterSlug: row.character_slug ?? null,
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
  const newIdVal = newId();
  await db.execute({
    sql: `INSERT INTO players (id, campaign_id, username, password_hash, display_name, character_id) VALUES (?,?,?,?,?,?)`,
    args: [newIdVal, campaignId, input.username, hashPassword(input.password), input.displayName, input.characterId ?? null],
  });
  return newIdVal;
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
