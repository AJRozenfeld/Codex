import {
  adminGetMoons,
  adminGetRegions,
  adminGetLocations,
  adminGetFactions,
  adminGetCharacters,
  adminGetStorylines,
  adminGetArtifacts,
  adminGetTimelineEvents,
  adminGetCharacterFactionIds,
  adminGetStorylineCharacterIds,
  adminGetTimelineEventCharacterIds,
} from "@/lib/admin-queries";
import { REGISTRY, ENTITY_TYPES, type EntityTypeKey } from "./registry";

// ---------------------------------------------------------------------------
// Gathers a campaign's rows into plain, registry-shaped records ready for
// serialize.ts. Every ref/refList field is resolved here to the OTHER
// entity's identity value (name/title) rather than its id - the MD format
// never stores raw ids, only human-readable names, so a DM can hand-edit or
// hand-author a file without knowing any internal id. Image fields are left
// holding whatever the DB stored (a Vercel Blob URL, a local /uploads/...
// path, or null) - export.ts is responsible for turning that into actual
// bytes + a zip-relative path; this module only reads the database.
// ---------------------------------------------------------------------------

export type FieldValue = string | number | boolean | string[] | null;

export interface CollectedEntity {
  id: string;
  identity: string;
  record: Record<string, FieldValue>;
}

export interface EntityOption {
  id: string;
  label: string;
}

/** id -> label maps for every v1 entity type, scoped to one campaign - used both to resolve ref fields here and to power the export UI's item pickers. */
export async function loadNameMaps(campaignId: string): Promise<Record<EntityTypeKey, Map<string, string>>> {
  const [moons, regions, locations, factions, characters, storylines, artifacts, timelineEvents] = await Promise.all([
    adminGetMoons(campaignId),
    adminGetRegions(campaignId),
    adminGetLocations(campaignId),
    adminGetFactions(campaignId),
    adminGetCharacters(campaignId),
    adminGetStorylines(campaignId),
    adminGetArtifacts(campaignId),
    adminGetTimelineEvents(campaignId),
  ]);
  return {
    moons: new Map(moons.map((m) => [m.id, m.name])),
    regions: new Map(regions.map((r) => [r.id, r.name])),
    locations: new Map(locations.map((l) => [l.id, l.name])),
    factions: new Map(factions.map((f) => [f.id, f.name])),
    characters: new Map(characters.map((c) => [c.id, c.name])),
    storylines: new Map(storylines.map((s) => [s.id, s.title])),
    artifacts: new Map(artifacts.map((a) => [a.id, a.name])),
    timelineEvents: new Map(timelineEvents.map((t) => [t.id, t.title])),
  };
}

/** { id, label } options per entity type, for the export UI's per-item checkboxes. */
export async function listPickerOptions(campaignId: string): Promise<Record<EntityTypeKey, EntityOption[]>> {
  const names = await loadNameMaps(campaignId);
  const out = {} as Record<EntityTypeKey, EntityOption[]>;
  for (const type of ENTITY_TYPES) {
    out[type] = Array.from(names[type].entries()).map(([id, label]) => ({ id, label }));
  }
  return out;
}

export async function collectEntities(
  campaignId: string,
  type: EntityTypeKey,
  idFilter?: Set<string> | null
): Promise<CollectedEntity[]> {
  const names = await loadNameMaps(campaignId);
  const ref = (t: EntityTypeKey, id: string | null | undefined): string | null =>
    id ? names[t].get(id) ?? null : null;

  switch (type) {
    case "moons": {
      const rows = await adminGetMoons(campaignId);
      return rows
        .filter((m) => !idFilter || idFilter.has(m.id))
        .map((m) => ({
          id: m.id,
          identity: m.name,
          record: {
            name: m.name,
            cycle: m.cycle,
            domain: m.domain,
            description: m.description,
            color: m.color,
            isGoddess: m.isGoddess,
            sortOrder: m.sortOrder,
          },
        }));
    }
    case "regions": {
      const rows = await adminGetRegions(campaignId);
      return rows
        .filter((r) => !idFilter || idFilter.has(r.id))
        .map((r) => ({
          id: r.id,
          identity: r.name,
          record: {
            name: r.name,
            type: r.type,
            capital: r.capital,
            government: r.government,
            faith: r.faith,
            moon: ref("moons", r.moonId),
            description: r.description,
            color: r.color,
            sortOrder: r.sortOrder,
            revealed: r.revealed,
          },
        }));
    }
    case "locations": {
      const rows = await adminGetLocations(campaignId);
      return rows
        .filter((l) => !idFilter || idFilter.has(l.id))
        .map((l) => ({
          id: l.id,
          identity: l.name,
          record: {
            name: l.name,
            type: l.type,
            parent: ref("locations", l.parentId),
            region: ref("regions", l.regionId),
            description: l.description,
            thumbnail: l.thumbnailPath,
            revealed: l.revealed,
            notes: l.notes,
          },
        }));
    }
    case "factions": {
      const rows = await adminGetFactions(campaignId);
      return rows
        .filter((f) => !idFilter || idFilter.has(f.id))
        .map((f) => ({
          id: f.id,
          identity: f.name,
          record: {
            name: f.name,
            type: f.type,
            region: ref("regions", f.regionId),
            description: f.description,
            goals: f.goals,
            notes: f.notes,
            revealed: f.revealed,
          },
        }));
    }
    case "characters": {
      const rows = await adminGetCharacters(campaignId);
      const filtered = rows.filter((c) => !idFilter || idFilter.has(c.id));
      const out: CollectedEntity[] = [];
      for (const c of filtered) {
        const factionIds = await adminGetCharacterFactionIds(c.id);
        out.push({
          id: c.id,
          identity: c.name,
          record: {
            name: c.name,
            isPc: c.isPc,
            isAlive: c.isAlive,
            race: c.race,
            charClass: c.charClass,
            status: c.status,
            summary: c.summary,
            bio: c.bio,
            tags: c.tags,
            portrait: c.portraitPath,
            revealed: c.revealed,
            location: ref("locations", c.locationId),
            factions: factionIds.map((fid) => names.factions.get(fid)).filter((n): n is string => !!n),
          },
        });
      }
      return out;
    }
    case "storylines": {
      const rows = await adminGetStorylines(campaignId);
      const filtered = rows.filter((s) => !idFilter || idFilter.has(s.id));
      const out: CollectedEntity[] = [];
      for (const s of filtered) {
        const characterIds = await adminGetStorylineCharacterIds(s.id);
        out.push({
          id: s.id,
          identity: s.title,
          record: {
            title: s.title,
            status: s.status,
            priority: s.priority,
            summary: s.summary,
            description: s.description,
            location: ref("locations", s.locationId),
            nextStep: s.nextStep,
            revealed: s.revealed,
            characters: characterIds.map((cid) => names.characters.get(cid)).filter((n): n is string => !!n),
          },
        });
      }
      return out;
    }
    case "artifacts": {
      const rows = await adminGetArtifacts(campaignId);
      return rows
        .filter((a) => !idFilter || idFilter.has(a.id))
        .map((a) => ({
          id: a.id,
          identity: a.name,
          record: {
            name: a.name,
            type: a.type,
            rarity: a.rarity,
            attunement: a.attunement,
            owner: ref("characters", a.ownerCharacterId),
            location: ref("locations", a.locationId),
            description: a.description,
            mechanics: a.mechanics,
            image: a.imagePath,
            revealed: a.revealed,
          },
        }));
    }
    case "timelineEvents": {
      const rows = await adminGetTimelineEvents(campaignId);
      const filtered = rows.filter((t) => !idFilter || idFilter.has(t.id));
      const out: CollectedEntity[] = [];
      for (const t of filtered) {
        const characterIds = await adminGetTimelineEventCharacterIds(t.id);
        out.push({
          id: t.id,
          identity: t.title,
          record: {
            title: t.title,
            description: t.description,
            inWorldDate: t.inWorldDate,
            sortIndex: t.sortIndex,
            sessionNumber: t.sessionNumber,
            eventType: t.eventType,
            location: ref("locations", t.locationId),
            storyline: ref("storylines", t.storylineId),
            revealed: t.revealed,
            characters: characterIds.map((cid) => names.characters.get(cid)).filter((n): n is string => !!n),
          },
        });
      }
      return out;
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown entity type: ${_exhaustive}`);
    }
  }
}

/** Every registered entity type at once, honoring an optional per-type id selection (absent/undefined = "all rows of that type"). */
export async function collectAll(
  campaignId: string,
  selection?: Partial<Record<EntityTypeKey, string[]>>
): Promise<Record<EntityTypeKey, CollectedEntity[]>> {
  const out = {} as Record<EntityTypeKey, CollectedEntity[]>;
  for (const type of ENTITY_TYPES) {
    if (selection && !(type in selection)) {
      out[type] = [];
      continue;
    }
    const idFilter = selection?.[type] ? new Set(selection[type]) : null;
    out[type] = await collectEntities(campaignId, type, idFilter);
  }
  return out;
}

// Referenced by serialize.ts for iteration order / tag names.
export { REGISTRY };
