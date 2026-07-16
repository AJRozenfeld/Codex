import { cache } from "react";
import { getDb, ensureSchema, newId, LEGACY_CAMPAIGN_ID, LEGACY_DM_ID } from "./db";
import { slugify } from "./slug";
import { getAdminSession } from "./auth";
import { getCurrentDmId, getDmAccount } from "./dm-queries";
import type { Campaign, InheritableEntityType } from "./types";

// ---------------------------------------------------------------------------
// Campaign CRUD + the "inherit from" copy-graph.
//
// Creating a campaign can optionally copy content across from an existing
// campaign (moons, regions, locations, factions, characters, storylines,
// artifacts, timeline events, maps+pins) so Aviv doesn't have to rebuild a
// world from scratch for a sequel campaign. Selection is per-entity, not
// per-type - Aviv picks exactly which characters, which maps, etc. to bring
// over, not "all characters" as a block. Per Aviv's explicit call:
//   - every copied row is forced to revealed = 0, regardless of its state
//     in the source campaign - a new campaign starts fully hidden.
//   - character journals and character sheets are NEVER copied - a copied
//     character starts with a blank journal and a blank sheet.
//   - player accounts and entity_player_access restrictions are NEVER
//     copied - those belong to the old campaign only.
// Copying proceeds in dependency order, remapping every id to a fresh UUID
// via an in-memory map, and any foreign key pointing at an entity that
// wasn't individually selected for copy is nulled out rather than left
// dangling or (far worse) left pointing at a row in a different campaign.
// ---------------------------------------------------------------------------

function rowToCampaign(row: any): Campaign {
  return {
    id: row.id as string,
    dmId: row.dm_id as string,
    slug: row.slug as string,
    name: row.name as string,
    showMoons: Boolean(row.show_moons),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// License system (2026-07-16): every function here is scoped to the current
// session's DM account, so one DM can never see or touch another DM's
// campaigns - same defensive pattern as campaign scoping in admin-queries.
export async function adminGetCampaigns(): Promise<Campaign[]> {
  await ensureSchema();
  const dmId = await getCurrentDmId();
  const r = await getDb().execute({
    sql: "SELECT * FROM campaigns WHERE dm_id = ? ORDER BY created_at ASC",
    args: [dmId],
  });
  return r.rows.map(rowToCampaign);
}

export async function adminGetCampaign(id: string): Promise<Campaign | null> {
  await ensureSchema();
  const dmId = await getCurrentDmId();
  const r = await getDb().execute({
    sql: "SELECT * FROM campaigns WHERE id = ? AND dm_id = ?",
    args: [id, dmId],
  });
  return r.rows[0] ? rowToCampaign(r.rows[0]) : null;
}

async function uniqueCampaignSlug(base: string): Promise<string> {
  const db = getDb();
  let slug = slugify(base) || "campaign";
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM campaigns WHERE slug = ?", args: [slug] });
    if (r.rows.length === 0) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

// Which specific rows to copy, per entity type - e.g. { characters: ["id1",
// "id2"], maps: ["id3"] }. A type absent from this object (or mapped to an
// empty array) is not copied at all.
export type InheritSelections = Partial<Record<InheritableEntityType, string[]>>;

export interface CreateCampaignInput {
  name: string;
  inheritFromCampaignId?: string | null;
  inheritSelections?: InheritSelections;
}

export async function adminCreateCampaign(input: CreateCampaignInput): Promise<Campaign> {
  await ensureSchema();
  const db = getDb();
  const dmId = await getCurrentDmId();

  // License quota: campaigns per account.
  const dm = await getDmAccount(dmId);
  const countR = await db.execute({ sql: "SELECT COUNT(*) AS n FROM campaigns WHERE dm_id = ?", args: [dmId] });
  if (dm && Number(countR.rows[0].n) >= dm.maxCampaigns) {
    throw new Error(`License limit reached: this account can have at most ${dm.maxCampaigns} campaign(s).`);
  }

  const id = newId();
  const slug = await uniqueCampaignSlug(input.name);
  // show_moons = 0: moons are Aviv's homebrew cosmology, not core D&D - new
  // campaigns start without that section regardless of which account owns them.
  await db.execute({
    sql: "INSERT INTO campaigns (id, dm_id, slug, name, show_moons) VALUES (?, ?, ?, ?, 0)",
    args: [id, dmId, slug, input.name],
  });

  const hasAnySelection =
    input.inheritSelections != null &&
    Object.values(input.inheritSelections).some((ids) => ids && ids.length > 0);

  if (input.inheritFromCampaignId && hasAnySelection) {
    await copyCampaignGraph(input.inheritFromCampaignId, id, input.inheritSelections!);
  }

  const created = await adminGetCampaign(id);
  return created!;
}

export async function adminRenameCampaign(id: string, name: string): Promise<void> {
  await ensureSchema();
  const dmId = await getCurrentDmId();
  await getDb().execute({
    sql: "UPDATE campaigns SET name = ?, updated_at = datetime('now') WHERE id = ? AND dm_id = ?",
    args: [name, id, dmId],
  });
}

/** Deletes a campaign and every row scoped to it (FK ON DELETE CASCADE handles the rest). */
export async function adminDeleteCampaign(id: string): Promise<void> {
  await ensureSchema();
  const dmId = await getCurrentDmId();
  // Never let a DM delete their last campaign - the admin panel (and
  // getCurrentCampaignId's fallback) always needs somewhere to land.
  const countR = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM campaigns WHERE dm_id = ?", args: [dmId] });
  if (Number(countR.rows[0].n) <= 1) {
    throw new Error("You can't delete your only campaign.");
  }
  await getDb().execute({ sql: "DELETE FROM campaigns WHERE id = ? AND dm_id = ?", args: [id, dmId] });
}

// ---------------------------------------------------------------------------
// Which campaign the DM is currently working in. Deliberately kept in this
// file (not auth.ts) - it needs db.ts, and auth.ts must stay importable from
// middleware.ts, which runs in the Edge runtime and can't bundle Node's
// "fs"/"path" (used by db.ts to read schema.sql off disk).
// ---------------------------------------------------------------------------

// PERFORMANCE: cache()d so the session unseal (and the ownership check) run
// once per request even though the admin layout AND every admin page both
// call this on every render.
// LICENSE SYSTEM: the remembered campaign must belong to the session's DM -
// a stale id from a different account (e.g. after switching logins in the
// same browser) silently falls through to the DM's own first campaign.
export const getCurrentCampaignId = cache(async (): Promise<string> => {
  const session = await getAdminSession();
  const dmId = session.dmId ?? LEGACY_DM_ID;
  await ensureSchema();
  const db = getDb();
  if (session.currentCampaignId) {
    const owned = await db.execute({
      sql: "SELECT id FROM campaigns WHERE id = ? AND dm_id = ?",
      args: [session.currentCampaignId, dmId],
    });
    if (owned.rows[0]) return session.currentCampaignId;
  }
  const first = await db.execute({
    sql: "SELECT id FROM campaigns WHERE dm_id = ? ORDER BY created_at ASC LIMIT 1",
    args: [dmId],
  });
  if (first.rows[0]) return first.rows[0].id as string;
  // Defensive: an account with zero campaigns (shouldn't happen - claiming
  // creates one, and deleting the last is blocked) still gets a fresh blank
  // campaign rather than a broken admin panel.
  const id = newId();
  await db.execute({
    sql: "INSERT INTO campaigns (id, dm_id, slug, name, show_moons) VALUES (?,?,?,?,0)",
    args: [id, dmId, `campaign-${id.slice(0, 8)}`, "New Campaign"],
  });
  return id;
});

export async function setCurrentCampaignId(campaignId: string): Promise<void> {
  const session = await getAdminSession();
  const dmId = session.dmId ?? LEGACY_DM_ID;
  await ensureSchema();
  // Refuse to point the session at a campaign this DM doesn't own.
  const owned = await getDb().execute({
    sql: "SELECT id FROM campaigns WHERE id = ? AND dm_id = ?",
    args: [campaignId, dmId],
  });
  if (!owned.rows[0]) return;
  session.currentCampaignId = campaignId;
  await session.save();
}

// ---------------------------------------------------------------------------
// The copy-graph itself.
// ---------------------------------------------------------------------------

type IdMap = Record<InheritableEntityType, Map<string, string>>;

function emptyIdMap(): IdMap {
  return {
    moons: new Map(),
    regions: new Map(),
    locations: new Map(),
    factions: new Map(),
    characters: new Map(),
    storylines: new Map(),
    artifacts: new Map(),
    timeline_events: new Map(),
    maps: new Map(),
  };
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

async function copyCampaignGraph(
  sourceCampaignId: string,
  newCampaignId: string,
  selections: InheritSelections
): Promise<void> {
  const db = getDb();
  const idMap = emptyIdMap();

  // Only the specific rows named in selections[type] are ever loaded, so
  // idMap[type] only ever contains entries for rows actually copied - a
  // plain lookup naturally returns nothing for a row that wasn't picked,
  // whether that's because its whole type was skipped or just that one row
  // was left unchecked.
  const remap = (type: InheritableEntityType, oldVal: unknown): string | null => {
    if (oldVal == null) return null;
    return idMap[type].get(oldVal as string) ?? null;
  };

  const moonIds = selections.moons ?? [];
  if (moonIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM moons WHERE campaign_id = ? AND id IN (${placeholders(moonIds.length)})`,
        args: [sourceCampaignId, ...moonIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.moons.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO moons (id, campaign_id, slug, name, cycle, domain, description, color, is_goddess, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [rid, newCampaignId, row.slug, row.name, row.cycle, row.domain, row.description, row.color, row.is_goddess, row.sort_order],
      });
    }
  }

  const regionIds = selections.regions ?? [];
  if (regionIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM regions WHERE campaign_id = ? AND id IN (${placeholders(regionIds.length)})`,
        args: [sourceCampaignId, ...regionIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.regions.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO regions (id, campaign_id, slug, name, type, capital, government, faith, moon_id, description, color, sort_order, revealed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [
          rid, newCampaignId, row.slug, row.name, row.type, row.capital, row.government, row.faith,
          remap("moons", row.moon_id), row.description, row.color, row.sort_order,
        ],
      });
    }
  }

  const locationIds = selections.locations ?? [];
  if (locationIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM locations WHERE campaign_id = ? AND id IN (${placeholders(locationIds.length)})`,
        args: [sourceCampaignId, ...locationIds],
      })
    ).rows;
    // Pass 1: insert every row with parent_id NULL (parents may not be mapped yet).
    for (const row of rows) {
      const rid = newId();
      idMap.locations.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO locations (id, campaign_id, slug, name, type, parent_id, region_id, description, thumbnail_path, revealed, notes)
              VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`,
        args: [rid, newCampaignId, row.slug, row.name, row.type, remap("regions", row.region_id), row.description, row.thumbnail_path, row.notes],
      });
    }
    // Pass 2: fix up parent_id now that every location in this batch has a mapping.
    // A location whose parent wasn't also selected for copy simply loses its
    // parent link (it becomes a top-level location) rather than pointing at
    // the old campaign's row.
    for (const row of rows) {
      if (row.parent_id == null) continue;
      const newParent = idMap.locations.get(row.parent_id as string);
      if (!newParent) continue;
      const ownNewId = idMap.locations.get(row.id as string);
      if (!ownNewId) continue; // always set in pass 1; guard only for TS narrowing
      await db.execute({
        sql: "UPDATE locations SET parent_id = ? WHERE id = ?",
        args: [newParent, ownNewId],
      });
    }
  }

  const factionIds = selections.factions ?? [];
  if (factionIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM factions WHERE campaign_id = ? AND id IN (${placeholders(factionIds.length)})`,
        args: [sourceCampaignId, ...factionIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.factions.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO factions (id, campaign_id, slug, name, type, region_id, description, goals, notes, revealed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [rid, newCampaignId, row.slug, row.name, row.type, remap("regions", row.region_id), row.description, row.goals, row.notes],
      });
    }
  }

  const characterIds = selections.characters ?? [];
  if (characterIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM characters WHERE campaign_id = ? AND id IN (${placeholders(characterIds.length)})`,
        args: [sourceCampaignId, ...characterIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.characters.set(row.id as string, rid);
      // Portrait image is copied by reference (same URL/path) - the image
      // itself doesn't belong to a campaign. Journal + character_sheet are
      // deliberately NOT copied (Aviv's call: new campaign starts blank).
      await db.execute({
        sql: `INSERT INTO characters (id, campaign_id, slug, name, is_pc, is_alive, race, char_class, status, summary, bio, tags, portrait_path, revealed, location_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        args: [
          rid, newCampaignId, row.slug, row.name, row.is_pc, row.is_alive, row.race, row.char_class, row.status,
          row.summary, row.bio, row.tags, row.portrait_path, remap("locations", row.location_id),
        ],
      });
    }
  }

  // character_factions: only copy links where BOTH endpoints were copied.
  if (idMap.characters.size > 0 && idMap.factions.size > 0) {
    const rows = (await db.execute({
      sql: `SELECT cf.* FROM character_factions cf
       JOIN characters c ON cf.character_id = c.id
       WHERE c.campaign_id = ?`,
      args: [sourceCampaignId],
    })).rows;
    for (const row of rows) {
      const newChar = idMap.characters.get(row.character_id as string);
      const newFac = idMap.factions.get(row.faction_id as string);
      if (!newChar || !newFac) continue;
      await db.execute({
        sql: "INSERT INTO character_factions (id, character_id, faction_id, role) VALUES (?, ?, ?, ?)",
        args: [newId(), newChar, newFac, row.role ?? null],
      });
    }
  }

  const storylineIds = selections.storylines ?? [];
  if (storylineIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM storylines WHERE campaign_id = ? AND id IN (${placeholders(storylineIds.length)})`,
        args: [sourceCampaignId, ...storylineIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.storylines.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO storylines (id, campaign_id, slug, title, status, priority, summary, description, location_id, next_step, revealed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [rid, newCampaignId, row.slug, row.title, row.status, row.priority, row.summary, row.description, remap("locations", row.location_id), row.next_step],
      });
    }
  }

  if (idMap.storylines.size > 0 && idMap.characters.size > 0) {
    const rows = (await db.execute({
      sql: `SELECT sc.* FROM storyline_characters sc
       JOIN storylines s ON sc.storyline_id = s.id
       WHERE s.campaign_id = ?`,
      args: [sourceCampaignId],
    })).rows;
    for (const row of rows) {
      const newStory = idMap.storylines.get(row.storyline_id as string);
      const newChar = idMap.characters.get(row.character_id as string);
      if (!newStory || !newChar) continue;
      await db.execute({
        sql: "INSERT INTO storyline_characters (id, storyline_id, character_id, role) VALUES (?, ?, ?, ?)",
        args: [newId(), newStory, newChar, row.role ?? null],
      });
    }
  }

  const artifactIds = selections.artifacts ?? [];
  if (artifactIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM artifacts WHERE campaign_id = ? AND id IN (${placeholders(artifactIds.length)})`,
        args: [sourceCampaignId, ...artifactIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.artifacts.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO artifacts (id, campaign_id, slug, name, type, rarity, attunement, owner_character_id, location_id, description, mechanics, image_path, revealed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [
          rid, newCampaignId, row.slug, row.name, row.type, row.rarity, row.attunement,
          remap("characters", row.owner_character_id), remap("locations", row.location_id),
          row.description, row.mechanics, row.image_path,
        ],
      });
    }
  }

  const timelineEventIds = selections.timeline_events ?? [];
  if (timelineEventIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM timeline_events WHERE campaign_id = ? AND id IN (${placeholders(timelineEventIds.length)})`,
        args: [sourceCampaignId, ...timelineEventIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.timeline_events.set(row.id as string, rid);
      await db.execute({
        sql: `INSERT INTO timeline_events (id, campaign_id, title, description, in_world_date, sort_index, session_number, event_type, location_id, storyline_id, revealed)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        args: [
          rid, newCampaignId, row.title, row.description, row.in_world_date, row.sort_index, row.session_number,
          row.event_type, remap("locations", row.location_id), remap("storylines", row.storyline_id),
        ],
      });
    }
  }

  if (idMap.timeline_events.size > 0 && idMap.characters.size > 0) {
    const rows = (await db.execute({
      sql: `SELECT ec.* FROM timeline_event_characters ec
       JOIN timeline_events e ON ec.event_id = e.id
       WHERE e.campaign_id = ?`,
      args: [sourceCampaignId],
    })).rows;
    for (const row of rows) {
      const newEvt = idMap.timeline_events.get(row.event_id as string);
      const newChar = idMap.characters.get(row.character_id as string);
      if (!newEvt || !newChar) continue;
      await db.execute({
        sql: "INSERT INTO timeline_event_characters (id, event_id, character_id) VALUES (?, ?, ?)",
        args: [newId(), newEvt, newChar],
      });
    }
  }

  const mapIds = selections.maps ?? [];
  if (mapIds.length > 0) {
    const rows = (
      await db.execute({
        sql: `SELECT * FROM maps WHERE campaign_id = ? AND id IN (${placeholders(mapIds.length)})`,
        args: [sourceCampaignId, ...mapIds],
      })
    ).rows;
    for (const row of rows) {
      const rid = newId();
      idMap.maps.set(row.id as string, rid);
      // Map image is copied by reference (same URL/path) - the image file
      // itself doesn't belong to a campaign.
      await db.execute({
        sql: `INSERT INTO maps (id, campaign_id, slug, name, image_url, location_id, is_root, revealed, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        args: [rid, newCampaignId, row.slug, row.name, row.image_url, remap("locations", row.location_id), row.is_root, row.sort_order],
      });
    }
    // map_pins: only copy pins whose owning map was copied; target_map_id
    // remapped if the target was also copied, else left pointing nowhere
    // (SET NULL) rather than cross-campaign. Pins aren't individually
    // selectable - picking a map brings its own pins along.
    const pinRows = (await db.execute({
      sql: `SELECT mp.* FROM map_pins mp
       JOIN maps m ON mp.map_id = m.id
       WHERE m.campaign_id = ?`,
      args: [sourceCampaignId],
    })).rows;
    for (const row of pinRows) {
      const newMapId = idMap.maps.get(row.map_id as string);
      if (!newMapId) continue;
      await db.execute({
        sql: `INSERT INTO map_pins (id, map_id, x, y, label, icon, target_map_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [newId(), newMapId, row.x, row.y, row.label, row.icon, remap("maps", row.target_map_id)],
      });
    }
  }

  // Deliberately not copied: character_sheets, journal_entries, players,
  // entity_player_access, app_settings - see file header.
}
