import { getDb, ensureSchema } from "./db";
import { resolveGmTagsOnFields, resolveGmTags } from "./gm-tags";
import type { ViewerContext } from "./player-session";
import type {
  Moon,
  Region,
  Location,
  Character,
  Faction,
  Storyline,
  Artifact,
  TimelineEvent,
  CharacterSummary,
  MapEntity,
  MapPin,
  MapRegion,
  CharacterMapToken,
} from "./types";

// ---------------------------------------------------------------------------
// PUBLIC read layer - everything here filters to the viewer's own campaign,
// then to `revealed = 1`, then to the per-player visibility model on top of
// that:
//   1. Whole-entity restriction: if an entity has rows in
//      entity_player_access, only the listed players (by id) can see it at
//      all - it's invisible to anonymous visitors and every other player.
//   2. In-text redaction: <GM approved="username,username">...</GM> spans
//      inside free-text fields are stripped unless the viewer's username is
//      in the approved list. Anonymous viewers never match.
// Every getter takes an optional `viewer` (defaults to anonymous) computed
// once per page via getViewerContext() in player-session.ts. viewer.campaignId
// is null for anonymous visitors, which naturally matches zero rows in every
// `campaign_id = ?` clause below - so even if a page somehow rendered without
// going through middleware.ts's site-wide login gate, nothing would leak.
// (The admin panel uses src/lib/admin-queries.ts instead, which sees everything
// unfiltered, scoped explicitly by an admin-selected campaignId.)
// ---------------------------------------------------------------------------

const ANONYMOUS: ViewerContext = { playerId: null, username: null, campaignId: null };

async function filterByPlayerAccess<T extends { id: string }>(
  entityType: string,
  rows: T[],
  viewerPlayerId: string | null
): Promise<T[]> {
  if (rows.length === 0) return rows;
  await ensureSchema();
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const r = await db.execute({
    sql: `SELECT entity_id, player_id FROM entity_player_access WHERE entity_type = ? AND entity_id IN (${ids
      .map(() => "?")
      .join(",")})`,
    args: [entityType, ...ids],
  });
  if (r.rows.length === 0) return rows;
  const restricted = new Map<string, Set<string>>();
  for (const row of r.rows) {
    const eid = row.entity_id as string;
    const pid = row.player_id as string;
    if (!restricted.has(eid)) restricted.set(eid, new Set());
    restricted.get(eid)!.add(pid);
  }
  return rows.filter((row) => {
    const allowed = restricted.get(row.id);
    if (!allowed) return true;
    return viewerPlayerId != null && allowed.has(viewerPlayerId);
  });
}

async function checkPlayerAccess(
  entityType: string,
  id: string,
  viewerPlayerId: string | null
): Promise<boolean> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT player_id FROM entity_player_access WHERE entity_type = ? AND entity_id = ?`,
    args: [entityType, id],
  });
  if (r.rows.length === 0) return true;
  if (!viewerPlayerId) return false;
  return r.rows.some((row) => (row.player_id as string) === viewerPlayerId);
}

export async function getMoons(viewer: ViewerContext = ANONYMOUS): Promise<Moon[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT * FROM moons WHERE campaign_id = ? ORDER BY sort_order ASC, name ASC",
    args: [viewer.campaignId],
  });
  return r.rows.map(rowToMoon);
}

export async function getRegions(viewer: ViewerContext = ANONYMOUS): Promise<Region[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT r.*, m.name AS moon_name
          FROM regions r LEFT JOIN moons m ON m.id = r.moon_id
          WHERE r.revealed = 1 AND r.campaign_id = ?
          ORDER BY r.sort_order ASC, r.name ASC`,
    args: [viewer.campaignId],
  });
  let regions = r.rows.map(rowToRegion);
  regions = await filterByPlayerAccess("regions", regions, viewer.playerId);
  return regions.map((rg) => resolveGmTagsOnFields(rg, viewer.username, ["description"]));
}

export async function getRegionBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Region | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT r.*, m.name AS moon_name
          FROM regions r LEFT JOIN moons m ON m.id = r.moon_id
          WHERE r.slug = ? AND r.revealed = 1 AND r.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const region = rowToRegion(r.rows[0]);
  const allowed = await checkPlayerAccess("regions", region.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(region, viewer.username, ["description"]);
}

export async function getLocations(viewer: ViewerContext = ANONYMOUS): Promise<Location[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT l.*, p.name AS parent_name, p.slug AS parent_slug,
                 rg.name AS region_name, rg.slug AS region_slug
          FROM locations l
          LEFT JOIN locations p ON p.id = l.parent_id
          LEFT JOIN regions rg ON rg.id = l.region_id
          WHERE l.revealed = 1 AND l.campaign_id = ?
          ORDER BY l.name ASC`,
    args: [viewer.campaignId],
  });
  let locations = r.rows.map(rowToLocation);
  locations = await filterByPlayerAccess("locations", locations, viewer.playerId);
  return locations.map((l) => resolveGmTagsOnFields(l, viewer.username, ["description", "notes"]));
}

export async function getLocationBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Location | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT l.*, p.name AS parent_name, p.slug AS parent_slug,
                 rg.name AS region_name, rg.slug AS region_slug
          FROM locations l
          LEFT JOIN locations p ON p.id = l.parent_id
          LEFT JOIN regions rg ON rg.id = l.region_id
          WHERE l.slug = ? AND l.revealed = 1 AND l.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const location = rowToLocation(r.rows[0]);
  const allowed = await checkPlayerAccess("locations", location.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(location, viewer.username, ["description", "notes"]);
}

export async function getChildLocations(locationId: string, viewer: ViewerContext = ANONYMOUS): Promise<Location[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT l.*, p.name AS parent_name, p.slug AS parent_slug,
                 rg.name AS region_name, rg.slug AS region_slug
          FROM locations l
          LEFT JOIN locations p ON p.id = l.parent_id
          LEFT JOIN regions rg ON rg.id = l.region_id
          WHERE l.parent_id = ? AND l.revealed = 1 AND l.campaign_id = ?
          ORDER BY l.name ASC`,
    args: [locationId, viewer.campaignId],
  });
  let locations = r.rows.map(rowToLocation);
  locations = await filterByPlayerAccess("locations", locations, viewer.playerId);
  return locations.map((l) => resolveGmTagsOnFields(l, viewer.username, ["description", "notes"]));
}

export async function getCharacters(viewer: ViewerContext = ANONYMOUS): Promise<Character[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.*, loc.name AS location_name, loc.slug AS location_slug
          FROM characters c LEFT JOIN locations loc ON loc.id = c.location_id
          WHERE c.revealed = 1 AND c.campaign_id = ?
          ORDER BY c.is_pc DESC, c.name ASC`,
    args: [viewer.campaignId],
  });
  let characters = r.rows.map(rowToCharacter);
  characters = await filterByPlayerAccess("characters", characters, viewer.playerId);
  return characters.map((c) => resolveGmTagsOnFields(c, viewer.username, ["summary", "bio"]));
}

export async function getCharacterBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Character | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.*, loc.name AS location_name, loc.slug AS location_slug
          FROM characters c LEFT JOIN locations loc ON loc.id = c.location_id
          WHERE c.slug = ? AND c.revealed = 1 AND c.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const character = rowToCharacter(r.rows[0]);
  const allowed = await checkPlayerAccess("characters", character.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(character, viewer.username, ["summary", "bio"]);
}

export async function getCharacterFactions(characterId: string, viewer: ViewerContext = ANONYMOUS): Promise<
  { faction: Faction; role: string | null }[]
> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT f.*, cf.role AS member_role
          FROM character_factions cf
          JOIN factions f ON f.id = cf.faction_id
          WHERE cf.character_id = ? AND f.revealed = 1 AND f.campaign_id = ?
          ORDER BY f.name ASC`,
    args: [characterId, viewer.campaignId],
  });
  let factions = r.rows.map(rowToFaction);
  factions = await filterByPlayerAccess("factions", factions, viewer.playerId);
  const roleById = new Map(r.rows.map((row) => [row.id as string, (row.member_role as string) ?? null]));
  return factions.map((faction) => ({
    faction: resolveGmTagsOnFields(faction, viewer.username, ["description", "goals", "notes"]),
    role: roleById.get(faction.id) ?? null,
  }));
}

export async function getFactions(viewer: ViewerContext = ANONYMOUS): Promise<Faction[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT f.*, rg.name AS region_name, rg.slug AS region_slug
          FROM factions f LEFT JOIN regions rg ON rg.id = f.region_id
          WHERE f.revealed = 1 AND f.campaign_id = ?
          ORDER BY f.name ASC`,
    args: [viewer.campaignId],
  });
  let factions = r.rows.map(rowToFaction);
  factions = await filterByPlayerAccess("factions", factions, viewer.playerId);
  return factions.map((f) => resolveGmTagsOnFields(f, viewer.username, ["description", "goals", "notes"]));
}

export async function getFactionBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Faction | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT f.*, rg.name AS region_name, rg.slug AS region_slug
          FROM factions f LEFT JOIN regions rg ON rg.id = f.region_id
          WHERE f.slug = ? AND f.revealed = 1 AND f.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const faction = rowToFaction(r.rows[0]);
  const allowed = await checkPlayerAccess("factions", faction.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(faction, viewer.username, ["description", "goals", "notes"]);
}

export async function getFactionMembers(factionId: string, viewer: ViewerContext = ANONYMOUS): Promise<CharacterSummary[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.id, c.slug, c.name, cf.role
          FROM character_factions cf
          JOIN characters c ON c.id = cf.character_id
          WHERE cf.faction_id = ? AND c.revealed = 1 AND c.campaign_id = ?
          ORDER BY c.name ASC`,
    args: [factionId, viewer.campaignId],
  });
  let members = r.rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    role: (row.role as string) ?? null,
  }));
  members = await filterByPlayerAccess("characters", members, viewer.playerId);
  return members;
}

export async function getStorylines(viewer: ViewerContext = ANONYMOUS): Promise<Storyline[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT s.*, loc.name AS location_name, loc.slug AS location_slug
          FROM storylines s LEFT JOIN locations loc ON loc.id = s.location_id
          WHERE s.revealed = 1 AND s.campaign_id = ?
          ORDER BY CASE s.status WHEN 'Active' THEN 0 WHEN 'Dormant' THEN 1 WHEN 'Background' THEN 2 ELSE 3 END, s.title ASC`,
    args: [viewer.campaignId],
  });
  let storylines = r.rows.map(rowToStoryline);
  storylines = await filterByPlayerAccess("storylines", storylines, viewer.playerId);
  return storylines.map((s) => resolveGmTagsOnFields(s, viewer.username, ["summary", "description", "nextStep"]));
}

export async function getStorylineBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Storyline | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT s.*, loc.name AS location_name, loc.slug AS location_slug
          FROM storylines s LEFT JOIN locations loc ON loc.id = s.location_id
          WHERE s.slug = ? AND s.revealed = 1 AND s.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const storyline = rowToStoryline(r.rows[0]);
  const allowed = await checkPlayerAccess("storylines", storyline.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(storyline, viewer.username, ["summary", "description", "nextStep"]);
}

export async function getStorylineCharacters(storylineId: string, viewer: ViewerContext = ANONYMOUS): Promise<CharacterSummary[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.id, c.slug, c.name, sc.role
          FROM storyline_characters sc
          JOIN characters c ON c.id = sc.character_id
          WHERE sc.storyline_id = ? AND c.revealed = 1 AND c.campaign_id = ?
          ORDER BY c.name ASC`,
    args: [storylineId, viewer.campaignId],
  });
  let members = r.rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    role: (row.role as string) ?? null,
  }));
  members = await filterByPlayerAccess("characters", members, viewer.playerId);
  return members;
}

export async function getArtifacts(viewer: ViewerContext = ANONYMOUS): Promise<Artifact[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT a.*, owner.name AS owner_name, owner.slug AS owner_slug,
                 loc.name AS location_name, loc.slug AS location_slug
          FROM artifacts a
          LEFT JOIN characters owner ON owner.id = a.owner_character_id
          LEFT JOIN locations loc ON loc.id = a.location_id
          WHERE a.revealed = 1 AND a.campaign_id = ?
          ORDER BY a.name ASC`,
    args: [viewer.campaignId],
  });
  let artifacts = r.rows.map(rowToArtifact);
  artifacts = await filterByPlayerAccess("artifacts", artifacts, viewer.playerId);
  return artifacts.map((a) => resolveGmTagsOnFields(a, viewer.username, ["description", "mechanics"]));
}

export async function getArtifactBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<Artifact | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT a.*, owner.name AS owner_name, owner.slug AS owner_slug,
                 loc.name AS location_name, loc.slug AS location_slug
          FROM artifacts a
          LEFT JOIN characters owner ON owner.id = a.owner_character_id
          LEFT JOIN locations loc ON loc.id = a.location_id
          WHERE a.slug = ? AND a.revealed = 1 AND a.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const artifact = rowToArtifact(r.rows[0]);
  const allowed = await checkPlayerAccess("artifacts", artifact.id, viewer.playerId);
  if (!allowed) return null;
  return resolveGmTagsOnFields(artifact, viewer.username, ["description", "mechanics"]);
}

export async function getTimelineEvents(viewer: ViewerContext = ANONYMOUS): Promise<TimelineEvent[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT t.*, loc.name AS location_name, loc.slug AS location_slug
          FROM timeline_events t LEFT JOIN locations loc ON loc.id = t.location_id
          WHERE t.revealed = 1 AND t.campaign_id = ?
          ORDER BY t.sort_index ASC`,
    args: [viewer.campaignId],
  });
  let events = r.rows.map(rowToTimelineEvent);
  events = await filterByPlayerAccess("timeline_events", events, viewer.playerId);
  return events.map((e) => resolveGmTagsOnFields(e, viewer.username, ["description"]));
}

export async function getTimelineEventCharacters(eventId: string, viewer: ViewerContext = ANONYMOUS): Promise<CharacterSummary[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.id, c.slug, c.name
          FROM timeline_event_characters tec
          JOIN characters c ON c.id = tec.character_id
          WHERE tec.event_id = ? AND c.revealed = 1 AND c.campaign_id = ?
          ORDER BY c.name ASC`,
    args: [eventId, viewer.campaignId],
  });
  let members = r.rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
  }));
  members = await filterByPlayerAccess("characters", members, viewer.playerId);
  return members;
}

export interface SearchResult {
  type: "Character" | "Location" | "Faction" | "Storyline" | "Artifact" | "Region";
  id: string;
  slug: string;
  title: string;
  snippet: string;
}

const SEARCH_TABLES: {
  type: SearchResult["type"];
  entityType: string;
  table: string;
  titleCol: string;
  textCols: string[];
}[] = [
  { type: "Character", entityType: "characters", table: "characters", titleCol: "name", textCols: ["summary", "bio"] },
  { type: "Location", entityType: "locations", table: "locations", titleCol: "name", textCols: ["description"] },
  { type: "Faction", entityType: "factions", table: "factions", titleCol: "name", textCols: ["description"] },
  { type: "Storyline", entityType: "storylines", table: "storylines", titleCol: "title", textCols: ["summary"] },
  { type: "Artifact", entityType: "artifacts", table: "artifacts", titleCol: "name", textCols: ["description"] },
  { type: "Region", entityType: "regions", table: "regions", titleCol: "name", textCols: ["description"] },
];

export async function search(query: string, viewer: ViewerContext = ANONYMOUS): Promise<SearchResult[]> {
  await ensureSchema();
  if (!query.trim()) return [];
  const db = getDb();
  const like = `%${query.trim()}%`;
  const results: SearchResult[] = [];

  for (const t of SEARCH_TABLES) {
    const likeClauses = t.textCols.map((c) => `${c} LIKE ?`).concat([`${t.titleCol} LIKE ?`]).join(" OR ");
    const args = [viewer.campaignId, ...t.textCols.map(() => like), like];
    const rows = await db.execute({
      sql: `SELECT id, slug, ${t.titleCol}, ${t.textCols[0]} AS snippet_col FROM ${t.table} WHERE revealed = 1 AND campaign_id = ? AND (${likeClauses}) LIMIT 20`,
      args,
    });
    let matches = rows.rows.map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      title: row[t.titleCol] as string,
      snippet: (row.snippet_col as string) ?? "",
    }));
    matches = await filterByPlayerAccess(t.entityType, matches, viewer.playerId);
    for (const m of matches) {
      const snippet = resolveGmTags(m.snippet, viewer.username);
      // If the only match was inside a now-stripped GM tag, don't surface it.
      if (!snippet.toLowerCase().includes(query.trim().toLowerCase()) && !m.title.toLowerCase().includes(query.trim().toLowerCase())) {
        continue;
      }
      results.push({ type: t.type, id: m.id, slug: m.slug, title: m.title, snippet });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Row -> camelCase mappers (shared with admin-queries.ts)
// ---------------------------------------------------------------------------

export function rowToMoon(row: any): Moon {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    cycle: row.cycle ?? null,
    domain: row.domain,
    description: row.description,
    color: row.color ?? null,
    isGoddess: !!row.is_goddess,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function rowToRegion(row: any): Region {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    capital: row.capital ?? null,
    government: row.government ?? null,
    faith: row.faith ?? null,
    moonId: row.moon_id ?? null,
    moonName: row.moon_name ?? null,
    description: row.description,
    color: row.color ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    revealed: !!row.revealed,
  };
}

export function rowToLocation(row: any): Location {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    parentId: row.parent_id ?? null,
    parentName: row.parent_name ?? null,
    parentSlug: row.parent_slug ?? null,
    regionId: row.region_id ?? null,
    regionName: row.region_name ?? null,
    regionSlug: row.region_slug ?? null,
    description: row.description,
    thumbnailPath: row.thumbnail_path ?? null,
    revealed: !!row.revealed,
    notes: row.notes ?? null,
  };
}

export function rowToCharacter(row: any): Character {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isPc: !!row.is_pc,
    isAlive: !!row.is_alive,
    race: row.race ?? null,
    charClass: row.char_class ?? null,
    status: row.status ?? null,
    summary: row.summary,
    bio: row.bio,
    tags: row.tags ?? null,
    portraitPath: row.portrait_path ?? null,
    revealed: !!row.revealed,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    locationSlug: row.location_slug ?? null,
  };
}

export function rowToFaction(row: any): Faction {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    regionId: row.region_id ?? null,
    regionName: row.region_name ?? null,
    regionSlug: row.region_slug ?? null,
    description: row.description,
    goals: row.goals ?? null,
    notes: row.notes ?? null,
    revealed: !!row.revealed,
  };
}

export function rowToStoryline(row: any): Storyline {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    priority: row.priority ?? null,
    summary: row.summary,
    description: row.description ?? null,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    locationSlug: row.location_slug ?? null,
    nextStep: row.next_step ?? null,
    revealed: !!row.revealed,
  };
}

export function rowToArtifact(row: any): Artifact {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    rarity: row.rarity ?? null,
    attunement: !!row.attunement,
    ownerCharacterId: row.owner_character_id ?? null,
    ownerName: row.owner_name ?? null,
    ownerSlug: row.owner_slug ?? null,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    locationSlug: row.location_slug ?? null,
    description: row.description,
    mechanics: row.mechanics ?? null,
    imagePath: row.image_path ?? null,
    revealed: !!row.revealed,
  };
}

export function rowToTimelineEvent(row: any): TimelineEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    inWorldDate: row.in_world_date ?? null,
    sortIndex: Number(row.sort_index ?? 0),
    sessionNumber: row.session_number != null ? Number(row.session_number) : null,
    eventType: row.event_type,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    locationSlug: row.location_slug ?? null,
    storylineId: row.storyline_id ?? null,
    revealed: !!row.revealed,
  };
}

// ---------------------------------------------------------------------------
// Maps. getMapExplorerData returns the whole visible map graph (every
// revealed + access-permitted map, each with its pins) in one call, since
// the public /maps page is a single client-side explorer that switches
// between maps locally (zoom animation, no reload, no extra round-trips).
// Pins whose target map isn't visible to this viewer are dropped - a pin
// that links nowhere reachable would just be a dead click.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Character map tokens. Shared resolution logic used by both the public
// explorer (revealed + access-filtered characters, below) and the admin map
// editor (every character, unfiltered - see adminGetCharacterMapTokens in
// admin-queries.ts). A character's token position on a given map is:
//   1. A manual override, if the DM has dragged one for this exact
//      (map, character) pair - takes precedence over everything.
//   2. Otherwise, walk up the character's location's parent chain (starting
//      at their own exact location) and use the center of the first region
//      on THIS map whose location matches. This is what makes "closest
//      location available" work: an unmapped/unregioned location simply
//      falls through to its parent.
//   3. If neither resolves, the character has no token on this map at all.
// ---------------------------------------------------------------------------

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolveCharacterAnchor(
  characterId: string,
  characterLocationId: string | null,
  regionsByLocation: Map<string, RegionRect>,
  overridesByCharacter: Map<string, { x: number; y: number }>,
  parentOf: Map<string, string | null>
): { x: number; y: number } | null {
  const override = overridesByCharacter.get(characterId);
  if (override) return override;
  if (!characterLocationId) return null;
  let current: string | null = characterLocationId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const region = regionsByLocation.get(current);
    if (region) return { x: region.x + region.width / 2, y: region.y + region.height / 2 };
    current = parentOf.get(current) ?? null;
  }
  return null;
}

export async function getMapExplorerData(viewer: ViewerContext = ANONYMOUS): Promise<MapEntity[]> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT m.*, l.name AS location_name, l.slug AS location_slug
          FROM maps m LEFT JOIN locations l ON l.id = m.location_id
          WHERE m.revealed = 1 AND m.campaign_id = ?
          ORDER BY m.sort_order ASC, m.name ASC`,
    args: [viewer.campaignId],
  });
  let maps = r.rows.map(rowToMap);
  maps = await filterByPlayerAccess("maps", maps, viewer.playerId);
  const visibleIds = new Set(maps.map((m) => m.id));

  if (maps.length === 0) return [];

  const mapIds = maps.map((m) => m.id);

  const pinsResult = await db.execute({
    sql: `SELECT p.*, t.slug AS target_map_slug, t.name AS target_map_name
          FROM map_pins p LEFT JOIN maps t ON t.id = p.target_map_id
          WHERE p.map_id IN (${mapIds.map(() => "?").join(",")})`,
    args: mapIds,
  });
  const pinsByMap = new Map<string, MapPin[]>();
  for (const row of pinsResult.rows) {
    const pin = rowToMapPin(row);
    if (pin.targetMapId && !visibleIds.has(pin.targetMapId)) {
      pin.targetMapId = null;
      pin.targetMapSlug = null;
      pin.targetMapName = null;
    }
    pin.label = pin.label ? resolveGmTags(pin.label, viewer.username) : pin.label;
    const list = pinsByMap.get(pin.mapId) ?? [];
    list.push(pin);
    pinsByMap.set(pin.mapId, list);
  }

  const tokensByMap = new Map<string, CharacterMapToken[]>();
  const characters = (await getCharacters(viewer)).filter((c) => c.locationId);
  if (characters.length > 0) {
    const locResult = await db.execute({
      sql: "SELECT id, parent_id FROM locations WHERE campaign_id = ?",
      args: [viewer.campaignId],
    });
    const parentOf = new Map<string, string | null>();
    for (const row of locResult.rows) parentOf.set(row.id as string, (row.parent_id as string) ?? null);

    const regionsResult = await db.execute({
      sql: `SELECT * FROM map_regions WHERE map_id IN (${mapIds.map(() => "?").join(",")})`,
      args: mapIds,
    });
    const regionsByMap = new Map<string, Map<string, RegionRect>>();
    for (const row of regionsResult.rows) {
      const mapId = row.map_id as string;
      const byLoc = regionsByMap.get(mapId) ?? new Map<string, RegionRect>();
      if (!byLoc.has(row.location_id as string)) {
        byLoc.set(row.location_id as string, {
          x: Number(row.x),
          y: Number(row.y),
          width: Number(row.width),
          height: Number(row.height),
        });
      }
      regionsByMap.set(mapId, byLoc);
    }

    const overridesResult = await db.execute({
      sql: `SELECT * FROM character_map_positions WHERE map_id IN (${mapIds.map(() => "?").join(",")})`,
      args: mapIds,
    });
    const overridesByMap = new Map<string, Map<string, { x: number; y: number }>>();
    for (const row of overridesResult.rows) {
      const mapId = row.map_id as string;
      const byChar = overridesByMap.get(mapId) ?? new Map<string, { x: number; y: number }>();
      byChar.set(row.character_id as string, { x: Number(row.x), y: Number(row.y) });
      overridesByMap.set(mapId, byChar);
    }

    for (const mapId of mapIds) {
      const regionsByLocation = regionsByMap.get(mapId) ?? new Map<string, RegionRect>();
      const overridesByCharacter = overridesByMap.get(mapId) ?? new Map<string, { x: number; y: number }>();
      const tokens: CharacterMapToken[] = [];
      for (const c of characters) {
        const anchor = resolveCharacterAnchor(c.id, c.locationId, regionsByLocation, overridesByCharacter, parentOf);
        if (!anchor) continue;
        tokens.push({
          characterId: c.id,
          name: c.name,
          slug: c.slug,
          summary: c.summary,
          portraitPath: c.portraitPath,
          x: anchor.x,
          y: anchor.y,
        });
      }
      tokensByMap.set(mapId, tokens);
    }
  }

  return maps.map((m) => ({ ...m, pins: pinsByMap.get(m.id) ?? [], tokens: tokensByMap.get(m.id) ?? [] }));
}

export async function getMapBySlug(slug: string, viewer: ViewerContext = ANONYMOUS): Promise<MapEntity | null> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT m.*, l.name AS location_name, l.slug AS location_slug
          FROM maps m LEFT JOIN locations l ON l.id = m.location_id
          WHERE m.slug = ? AND m.revealed = 1 AND m.campaign_id = ?`,
    args: [slug, viewer.campaignId],
  });
  if (!r.rows[0]) return null;
  const map = rowToMap(r.rows[0]);
  const allowed = await checkPlayerAccess("maps", map.id, viewer.playerId);
  if (!allowed) return null;
  return map;
}

export function rowToMap(row: any): MapEntity {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageUrl: row.image_url,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    locationSlug: row.location_slug ?? null,
    isRoot: !!row.is_root,
    revealed: !!row.revealed,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function rowToMapRegion(row: any): MapRegion {
  return {
    id: row.id,
    mapId: row.map_id,
    locationId: row.location_id,
    locationName: row.location_name ?? null,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
  };
}

export function rowToMapPin(row: any): MapPin {
  return {
    id: row.id,
    mapId: row.map_id,
    x: Number(row.x),
    y: Number(row.y),
    label: row.label ?? null,
    icon: row.icon ?? null,
    targetMapId: row.target_map_id ?? null,
    targetMapSlug: row.target_map_slug ?? null,
    targetMapName: row.target_map_name ?? null,
  };
}
