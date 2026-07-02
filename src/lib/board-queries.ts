import { getDb, ensureSchema, newId } from "./db";
import {
  adminGetMoon,
  adminGetRegion,
  adminGetLocation,
  adminGetFaction,
  adminGetCharacter,
  adminGetStoryline,
  adminGetArtifact,
  adminGetTimelineEvent,
  adminGetMap,
  adminGetMoons,
  adminGetRegions,
  adminGetLocations,
  adminGetFactions,
  adminGetCharacters,
  adminGetStorylines,
  adminGetArtifacts,
  adminGetTimelineEvents,
  adminGetMaps,
} from "./admin-queries";
import type { BoardItem, BoardItemType, BoardLinkPreview, InheritableEntityType } from "./types";

// ---------------------------------------------------------------------------
// The DM Screen whiteboard: one continuous freeform board per campaign.
// Every function here is admin-only (called from server actions in
// src/app/admin/board/page.tsx) and scoped by campaignId, following the same
// pattern as admin-queries.ts. Never touches the public revealed/
// entity_player_access model - this is DM prep, not campaign content.
// ---------------------------------------------------------------------------

function rowToBoardItem(row: any): BoardItem {
  return {
    id: row.id as string,
    type: row.type as BoardItemType,
    title: (row.title as string) ?? null,
    body: (row.body as string) ?? null,
    color: (row.color as string) ?? null,
    entityType: (row.entity_type as InheritableEntityType) ?? null,
    entityId: (row.entity_id as string) ?? null,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    zIndex: Number(row.z_index ?? 0),
  };
}

export async function adminGetBoardItems(campaignId: string): Promise<BoardItem[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM dm_board_items WHERE campaign_id = ? ORDER BY z_index ASC, created_at ASC",
    args: [campaignId],
  });
  return r.rows.map(rowToBoardItem);
}

export interface CreateBoardItemInput {
  type: BoardItemType;
  title?: string | null;
  body?: string | null;
  entityType?: InheritableEntityType | null;
  entityId?: string | null;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

async function nextZIndex(campaignId: string): Promise<number> {
  const r = await getDb().execute({
    sql: "SELECT COALESCE(MAX(z_index), 0) AS mz FROM dm_board_items WHERE campaign_id = ?",
    args: [campaignId],
  });
  return Number(r.rows[0]?.mz ?? 0) + 1;
}

export async function adminCreateBoardItem(campaignId: string, input: CreateBoardItemInput): Promise<BoardItem> {
  await ensureSchema();
  const db = getDb();
  const id = newId();
  const zIndex = await nextZIndex(campaignId);
  await db.execute({
    sql: `INSERT INTO dm_board_items (id, campaign_id, type, title, body, entity_type, entity_id, x, y, width, height, z_index)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      campaignId,
      input.type,
      input.title ?? null,
      input.body ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.x,
      input.y,
      input.width ?? (input.type === "link" ? 240 : 260),
      input.height ?? (input.type === "link" ? 120 : 180),
      zIndex,
    ],
  });
  const r = await db.execute({ sql: "SELECT * FROM dm_board_items WHERE id = ?", args: [id] });
  return rowToBoardItem(r.rows[0]);
}

export interface UpdateBoardItemInput {
  title?: string | null;
  body?: string | null;
  color?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bringToFront?: boolean;
}

export async function adminUpdateBoardItem(campaignId: string, id: string, patch: UpdateBoardItemInput): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.body !== undefined) {
    sets.push("body = ?");
    args.push(patch.body);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    args.push(patch.color);
  }
  if (patch.x !== undefined) {
    sets.push("x = ?");
    args.push(patch.x);
  }
  if (patch.y !== undefined) {
    sets.push("y = ?");
    args.push(patch.y);
  }
  if (patch.width !== undefined) {
    sets.push("width = ?");
    args.push(patch.width);
  }
  if (patch.height !== undefined) {
    sets.push("height = ?");
    args.push(patch.height);
  }
  if (patch.bringToFront) {
    sets.push("z_index = ?");
    args.push(await nextZIndex(campaignId));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  args.push(id, campaignId);
  await db.execute({
    sql: `UPDATE dm_board_items SET ${sets.join(", ")} WHERE id = ? AND campaign_id = ?`,
    args,
  });
}

export async function adminDeleteBoardItem(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM dm_board_items WHERE id = ? AND campaign_id = ?",
    args: [id, campaignId],
  });
}

// ---------------------------------------------------------------------------
// Live preview for a 'link' item - resolved fresh on every board load so a
// renamed/re-portraited article always shows current info, never a stale
// snapshot from when the link was first dropped on the board. Returns null
// if the linked entity no longer exists (deleted since the link was made) -
// the board renders a "no longer exists" placeholder for that card.
// ---------------------------------------------------------------------------

const ADMIN_ROUTE_SEGMENT: Record<InheritableEntityType, string> = {
  moons: "moons",
  regions: "regions",
  locations: "locations",
  factions: "factions",
  characters: "characters",
  storylines: "storylines",
  artifacts: "artifacts",
  timeline_events: "timeline",
  maps: "maps",
};

export async function adminGetLinkPreview(
  campaignId: string,
  entityType: InheritableEntityType,
  entityId: string
): Promise<BoardLinkPreview | null> {
  const href = `/admin/${ADMIN_ROUTE_SEGMENT[entityType]}/${entityId}`;
  switch (entityType) {
    case "moons": {
      const m = await adminGetMoon(campaignId, entityId);
      return m ? { title: m.name, subtitle: m.isGoddess ? "Goddess" : "Moon", imageUrl: null, href } : null;
    }
    case "regions": {
      const r = await adminGetRegion(campaignId, entityId);
      return r ? { title: r.name, subtitle: r.type, imageUrl: null, href } : null;
    }
    case "locations": {
      const l = await adminGetLocation(campaignId, entityId);
      return l ? { title: l.name, subtitle: l.type, imageUrl: null, href } : null;
    }
    case "factions": {
      const f = await adminGetFaction(campaignId, entityId);
      return f ? { title: f.name, subtitle: f.type, imageUrl: null, href } : null;
    }
    case "characters": {
      const c = await adminGetCharacter(campaignId, entityId);
      return c
        ? { title: c.name, subtitle: c.charClass ?? (c.isPc ? "PC" : "NPC"), imageUrl: c.portraitPath ?? null, href }
        : null;
    }
    case "storylines": {
      const s = await adminGetStoryline(campaignId, entityId);
      return s ? { title: s.title, subtitle: s.status, imageUrl: null, href } : null;
    }
    case "artifacts": {
      const a = await adminGetArtifact(campaignId, entityId);
      return a ? { title: a.name, subtitle: a.type, imageUrl: a.imagePath ?? null, href } : null;
    }
    case "timeline_events": {
      const e = await adminGetTimelineEvent(campaignId, entityId);
      return e ? { title: e.title, subtitle: e.eventType, imageUrl: null, href } : null;
    }
    case "maps": {
      const m = await adminGetMap(campaignId, entityId);
      return m ? { title: m.name, subtitle: "Map", imageUrl: null, href } : null;
    }
    default:
      return null;
  }
}

export interface BoardItemWithPreview extends BoardItem {
  preview: BoardLinkPreview | null;
}

export async function adminGetBoardItemsWithPreviews(campaignId: string): Promise<BoardItemWithPreview[]> {
  const items = await adminGetBoardItems(campaignId);
  return Promise.all(
    items.map(async (item) => {
      if (item.type === "link" && item.entityType && item.entityId) {
        const preview = await adminGetLinkPreview(campaignId, item.entityType, item.entityId);
        return { ...item, preview };
      }
      return { ...item, preview: null };
    })
  );
}

// ---------------------------------------------------------------------------
// Quick-link search: find any existing article by name/title across every
// linkable type, scoped to the current campaign, regardless of revealed
// state - this is DM-only prep, not the public site's revealed-gated search.
// ---------------------------------------------------------------------------

export interface LinkSearchResult {
  entityType: InheritableEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
}

export async function adminSearchLinkableEntities(campaignId: string, query: string): Promise<LinkSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const [moons, regions, locations, factions, characters, storylines, artifacts, events, maps] = await Promise.all([
    adminGetMoons(campaignId),
    adminGetRegions(campaignId),
    adminGetLocations(campaignId),
    adminGetFactions(campaignId),
    adminGetCharacters(campaignId),
    adminGetStorylines(campaignId),
    adminGetArtifacts(campaignId),
    adminGetTimelineEvents(campaignId),
    adminGetMaps(campaignId),
  ]);
  const results: LinkSearchResult[] = [];
  const push = (
    entityType: InheritableEntityType,
    entityId: string,
    title: string,
    subtitle: string | null,
    imageUrl: string | null
  ) => {
    if (title.toLowerCase().includes(q)) {
      results.push({ entityType, entityId, title, subtitle, imageUrl });
    }
  };
  moons.forEach((m) => push("moons", m.id, m.name, m.isGoddess ? "Goddess" : "Moon", null));
  regions.forEach((r) => push("regions", r.id, r.name, r.type, null));
  locations.forEach((l) => push("locations", l.id, l.name, l.type, null));
  factions.forEach((f) => push("factions", f.id, f.name, f.type, null));
  characters.forEach((c) => push("characters", c.id, c.name, c.charClass ?? (c.isPc ? "PC" : "NPC"), c.portraitPath));
  storylines.forEach((s) => push("storylines", s.id, s.title, s.status, null));
  artifacts.forEach((a) => push("artifacts", a.id, a.name, a.type, a.imagePath));
  events.forEach((e) => push("timeline_events", e.id, e.title, e.eventType, null));
  maps.forEach((m) => push("maps", m.id, m.name, "Map", null));
  return results.slice(0, 30);
}
