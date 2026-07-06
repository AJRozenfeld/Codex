import { File } from "node:buffer";
import JSZip from "jszip";
import { getDb, ensureSchema, newId } from "@/lib/db";
import { adminCreateCampaign } from "@/lib/campaign-queries";
import { uploadImage } from "@/lib/blob-storage";
import {
  adminUpsertMoon,
  adminUpsertRegion,
  adminUpsertLocation,
  adminUpsertFaction,
  adminUpsertCharacter,
  adminUpsertStoryline,
  adminUpsertArtifact,
  adminUpsertTimelineEvent,
} from "@/lib/admin-queries";
import { saveCharacterSheet, mergeWithDefaults } from "@/lib/character-sheet";
import type { CharacterSheetData } from "@/lib/types";
import { REGISTRY, ENTITY_TYPES, IMPORT_ORDER, type EntityTypeKey } from "./registry";
import { loadNameMaps } from "./collect";
import { parseCampaignMd, type RawEntity } from "./parse";

// ---------------------------------------------------------------------------
// Import staging + commit. Two-phase, per Aviv's spec: (1) upload the zip,
// which parses the MD and immediately uploads every bundled image to Blob
// (accepting minor orphaned-blob waste if the DM cancels rather than
// engineering a fully transactional two-phase image commit - a deliberate
// simplification), staging the parsed result as JSON so the preview screen
// doesn't need the zip bytes anymore; (2) the DM picks a target campaign +
// which staged items to actually bring in, and commit resolves every
// reference and calls the SAME adminUpsert* functions the admin UI itself
// uses, so imported content is indistinguishable from hand-entered content.
//
// The per-type "translate a resolved registry record into this app's
// existing adminUpsert*Input shape" mappers below are deliberately NOT
// registry-driven, unlike everything else in campaign-io - they're tied to
// this app's current fixed built-in tables, which is exactly the kind of
// code a brand-new custom entity type could never plug into anyway (a truly
// new table needs its own migration + queries regardless of this feature;
// see the Templates/Articles deferral note in registry.ts). Adding a NEW
// field to an EXISTING v1 type only needs a mapper edit here, in step with
// admin-queries.ts itself changing.
// ---------------------------------------------------------------------------

interface StagedData {
  entities: Record<EntityTypeKey, RawEntity[]>;
  warnings: string[];
}

export interface StagePreviewType {
  label: string;
  count: number;
  identities: string[];
}

export interface StageResult {
  stagingId: string;
  preview: Record<EntityTypeKey, StagePreviewType>;
  warnings: string[];
}

async function pruneOldStagingRows(): Promise<void> {
  // Best-effort housekeeping - staged imports the DM never came back to
  // commit shouldn't accumulate forever. Not load-bearing for correctness.
  await getDb().execute("DELETE FROM import_staging WHERE created_at < datetime('now', '-2 days')");
}

export async function stageCampaignImport(zipBuffer: Buffer): Promise<StageResult> {
  await ensureSchema();
  await pruneOldStagingRows();

  const zip = await JSZip.loadAsync(zipBuffer);
  const mdFile = zip.file("campaign.md");
  if (!mdFile) {
    throw new Error('This zip doesn\'t contain a "campaign.md" file at its root - is it a Codex campaign export?');
  }
  const mdText = await mdFile.async("string");
  const { entities, warnings } = parseCampaignMd(mdText);

  const uploadWarnings: string[] = [];
  for (const type of ENTITY_TYPES) {
    const schema = REGISTRY[type];
    const imageFields = schema.fields.filter((f) => f.kind === "image");
    if (imageFields.length === 0) continue;
    for (const raw of entities[type]) {
      for (const field of imageFields) {
        const value = raw.record[field.key];
        if (typeof value !== "string" || !value) continue;
        const imgFile = zip.file(value);
        if (!imgFile) {
          uploadWarnings.push(`${schema.label} "${raw.identity}": referenced image "${value}" wasn't found in the zip - imported without it.`);
          raw.record[field.key] = null;
          continue;
        }
        const bytes = await imgFile.async("nodebuffer");
        const filename = value.split("/").pop() || `${newId()}.png`;
        const file = new File([bytes], filename) as unknown as globalThis.File;
        const url = await uploadImage(file, type);
        raw.record[field.key] = url;
      }
    }
  }

  const stagingId = newId();
  const allWarnings = [...warnings, ...uploadWarnings];
  const staged: StagedData = { entities, warnings: allWarnings };
  await getDb().execute({
    sql: "INSERT INTO import_staging (id, data) VALUES (?, ?)",
    args: [stagingId, JSON.stringify(staged)],
  });

  const preview = {} as Record<EntityTypeKey, StagePreviewType>;
  for (const type of ENTITY_TYPES) {
    preview[type] = {
      label: REGISTRY[type].label,
      count: entities[type].length,
      identities: entities[type].map((e) => e.identity),
    };
  }

  return { stagingId, preview, warnings: allWarnings };
}

/** Re-derives the same preview shape stageCampaignImport returned, for the review page after a redirect (the staged JSON already has everything needed - nothing extra to pass through the URL). Returns null if the staging row is gone (expired, already committed, or never existed). */
export async function getStagedImport(
  stagingId: string
): Promise<{ preview: Record<EntityTypeKey, StagePreviewType>; warnings: string[] } | null> {
  await ensureSchema();
  const row = (await getDb().execute({ sql: "SELECT data FROM import_staging WHERE id = ?", args: [stagingId] })).rows[0];
  if (!row) return null;
  const staged = JSON.parse(row.data as string) as StagedData;
  const preview = {} as Record<EntityTypeKey, StagePreviewType>;
  for (const type of ENTITY_TYPES) {
    preview[type] = {
      label: REGISTRY[type].label,
      count: staged.entities[type].length,
      identities: staged.entities[type].map((e) => e.identity),
    };
  }
  return { preview, warnings: staged.warnings };
}

export interface CommitTarget {
  mode: "existing" | "new";
  campaignId?: string;
  newCampaignName?: string;
}

export interface CommitSelection {
  /** Per-type array of identity values (name/title) to import; a type absent from this object means "import everything staged for that type". */
  types?: Partial<Record<EntityTypeKey, string[]>>;
}

export interface CommitReport {
  campaignId: string;
  created: Record<EntityTypeKey, number>;
  updated: Record<EntityTypeKey, number>;
  warnings: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function optStr(v: unknown): string | undefined {
  const s = str(v);
  return s === "" ? undefined : s;
}
function bool(v: unknown): boolean {
  return !!v;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function commitCampaignImport(
  stagingId: string,
  target: CommitTarget,
  selection?: CommitSelection
): Promise<CommitReport> {
  await ensureSchema();
  const db = getDb();
  const row = (await db.execute({ sql: "SELECT data FROM import_staging WHERE id = ?", args: [stagingId] })).rows[0];
  if (!row) {
    throw new Error("This staged import has expired or was already committed - please re-upload the zip and try again.");
  }
  const staged = JSON.parse(row.data as string) as StagedData;

  let campaignId: string;
  if (target.mode === "new") {
    const name = (target.newCampaignName ?? "").trim();
    if (!name) throw new Error("A campaign name is required to import into a new campaign.");
    const campaign = await adminCreateCampaign({ name });
    campaignId = campaign.id;
  } else {
    if (!target.campaignId) throw new Error("No target campaign was selected.");
    campaignId = target.campaignId;
  }

  const warnings: string[] = [...staged.warnings];
  const created = {} as Record<EntityTypeKey, number>;
  const updated = {} as Record<EntityTypeKey, number>;
  for (const type of ENTITY_TYPES) {
    created[type] = 0;
    updated[type] = 0;
  }

  // identity (name/title) -> id, per type - seeded from what's already in the
  // target campaign, then grown as this commit creates/updates rows, so a
  // type processed earlier in IMPORT_ORDER is immediately resolvable by a
  // later type's ref/refList fields.
  const existing = await loadNameMaps(campaignId);
  const byIdentity: Record<EntityTypeKey, Map<string, string>> = {} as any;
  for (const type of ENTITY_TYPES) {
    byIdentity[type] = new Map(Array.from(existing[type].entries()).map(([id, label]) => [label, id]));
  }

  function resolveRef(type: EntityTypeKey, name: string | null): string | null {
    if (!name) return null;
    return byIdentity[type].get(name) ?? null;
  }

  for (const type of IMPORT_ORDER) {
    const schema = REGISTRY[type];
    const wanted = selection?.types?.[type];
    const rawEntities = staged.entities[type].filter((e) => !wanted || wanted.includes(e.identity));

    // Locations are self-referential (parent) - handled here with the same
    // two-pass technique campaign-queries.ts's copyCampaignGraph already
    // uses: pass 1 creates/updates every selected location with parent left
    // blank, pass 2 patches parent_id directly now that every location in
    // this batch has a final id, resolving each parent name against both
    // this batch and the target campaign's pre-existing locations.
    if (type === "locations") {
      const pending: { id: string; parentName: string | null }[] = [];
      for (const raw of rawEntities) {
        const r = raw.record;
        const existingId = byIdentity.locations.get(raw.identity);
        const id = await adminUpsertLocation(
          campaignId,
          {
            name: str(r.name),
            type: str(r.type),
            parentId: null,
            regionId: (() => {
              const name = r.region;
              if (typeof name !== "string" || !name) return null;
              const rid = resolveRef("regions", name);
              if (!rid) warnings.push(`${schema.label} "${raw.identity}": couldn't resolve region "${name}" - left blank.`);
              return rid;
            })(),
            description: str(r.description),
            thumbnailPath: optStr(r.thumbnail),
            revealed: r.revealed === undefined ? true : bool(r.revealed),
            notes: optStr(r.notes),
          },
          existingId
        );
        if (existingId) updated.locations++;
        else created.locations++;
        byIdentity.locations.set(raw.identity, id);
        pending.push({ id, parentName: typeof r.parent === "string" && r.parent ? r.parent : null });
      }
      for (const p of pending) {
        if (!p.parentName) continue;
        const parentId = resolveRef("locations", p.parentName);
        if (!parentId) {
          warnings.push(`${schema.label}: couldn't resolve parent location "${p.parentName}" - left blank.`);
          continue;
        }
        if (parentId === p.id) {
          warnings.push(`${schema.label}: a location named its own self as parent ("${p.parentName}") - ignored.`);
          continue;
        }
        await db.execute({ sql: "UPDATE locations SET parent_id = ? WHERE id = ? AND campaign_id = ?", args: [parentId, p.id, campaignId] });
      }
      continue;
    }

    for (const raw of rawEntities) {
      const existingId = byIdentity[type].get(raw.identity);
      const rid = await commitOne(type, campaignId, schema, raw, resolveRef, warnings, existingId);
      if (existingId) updated[type]++;
      else created[type]++;
      byIdentity[type].set(raw.identity, rid);
    }
  }

  await db.execute({ sql: "DELETE FROM import_staging WHERE id = ?", args: [stagingId] });

  return { campaignId, created, updated, warnings };
}

async function commitOne(
  type: EntityTypeKey,
  campaignId: string,
  schema: (typeof REGISTRY)[EntityTypeKey],
  raw: RawEntity,
  resolveRef: (type: EntityTypeKey, name: string | null) => string | null,
  warnings: string[],
  existingId?: string
): Promise<string> {
  const r = raw.record;
  const refOrWarn = (field: string, targetType: EntityTypeKey, name: unknown): string | null => {
    if (typeof name !== "string" || !name) return null;
    const id = resolveRef(targetType, name);
    if (!id) warnings.push(`${schema.label} "${raw.identity}": couldn't resolve ${field} "${name}" - left blank.`);
    return id;
  };
  const refListOrWarn = (field: string, targetType: EntityTypeKey, names: unknown): string[] => {
    const list = Array.isArray(names) ? names : [];
    const ids: string[] = [];
    for (const name of list) {
      const id = resolveRef(targetType, String(name));
      if (!id) warnings.push(`${schema.label} "${raw.identity}": couldn't resolve ${field} member "${name}" - omitted.`);
      else ids.push(id);
    }
    return ids;
  };

  switch (type) {
    case "moons":
      return adminUpsertMoon(
        campaignId,
        {
          name: str(r.name),
          cycle: optStr(r.cycle),
          domain: str(r.domain),
          description: str(r.description),
          color: optStr(r.color),
          isGoddess: bool(r.isGoddess),
          sortOrder: num(r.sortOrder),
        },
        existingId
      );
    case "regions":
      return adminUpsertRegion(
        campaignId,
        {
          name: str(r.name),
          type: str(r.type),
          capital: optStr(r.capital),
          government: optStr(r.government),
          faith: optStr(r.faith),
          moonId: refOrWarn("moon", "moons", r.moon),
          description: str(r.description),
          color: optStr(r.color),
          sortOrder: num(r.sortOrder),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
        },
        existingId
      );
    case "locations":
      // Never reached - commitCampaignImport special-cases "locations" with
      // its own two-pass handling (self-referential parent) before this
      // function is called for that type. Kept here only so the switch
      // stays exhaustive over EntityTypeKey.
      throw new Error("locations are committed via the two-pass path in commitCampaignImport, not commitOne");
    case "factions":
      return adminUpsertFaction(
        campaignId,
        {
          name: str(r.name),
          type: str(r.type),
          regionId: refOrWarn("region", "regions", r.region),
          description: str(r.description),
          goals: optStr(r.goals),
          notes: optStr(r.notes),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
        },
        existingId
      );
    case "characters":
      return adminUpsertCharacter(
        campaignId,
        {
          name: str(r.name),
          isPc: bool(r.isPc),
          isAlive: r.isAlive === undefined ? true : bool(r.isAlive),
          race: optStr(r.race),
          charClass: optStr(r.charClass),
          status: optStr(r.status),
          summary: str(r.summary),
          bio: str(r.bio),
          tags: optStr(r.tags),
          portraitPath: optStr(r.portrait),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
          locationId: refOrWarn("location", "locations", r.location),
          factionIds: refListOrWarn("factions", "factions", r.factions),
        },
        existingId
      );
    case "characterSheets": {
      // Not a distinct DB row of its own from this pipeline's point of view -
      // character_sheets is a straight upsert-by-character_id (see
      // saveCharacterSheet in character-sheet.ts), so there's no separate
      // adminUpsert*Input shape to build. r.character is the OWNING
      // character's name (this type's identityField - see registry.ts);
      // resolve it the same way every other ref field does, then merge the
      // parsed JSON blob over CharacterSheetData's defaults so a
      // hand-edited/partial campaign.md can never write a half-shaped sheet.
      const characterId = refOrWarn("character", "characters", r.character);
      if (!characterId) return existingId ?? "";
      const data = mergeWithDefaults((r.data ?? {}) as Partial<CharacterSheetData>);
      await saveCharacterSheet(characterId, data);
      return characterId;
    }
    case "artifacts":
      return adminUpsertArtifact(
        campaignId,
        {
          name: str(r.name),
          type: str(r.type),
          rarity: optStr(r.rarity),
          attunement: bool(r.attunement),
          ownerCharacterId: refOrWarn("owner", "characters", r.owner),
          locationId: refOrWarn("location", "locations", r.location),
          description: str(r.description),
          mechanics: optStr(r.mechanics),
          imagePath: optStr(r.image),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
        },
        existingId
      );
    case "storylines":
      return adminUpsertStoryline(
        campaignId,
        {
          title: str(r.title),
          status: str(r.status),
          priority: optStr(r.priority),
          summary: str(r.summary),
          description: optStr(r.description),
          locationId: refOrWarn("location", "locations", r.location),
          nextStep: optStr(r.nextStep),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
          characterIds: refListOrWarn("characters", "characters", r.characters),
        },
        existingId
      );
    case "timelineEvents":
      return adminUpsertTimelineEvent(
        campaignId,
        {
          title: str(r.title),
          description: str(r.description),
          inWorldDate: optStr(r.inWorldDate),
          sortIndex: num(r.sortIndex),
          sessionNumber: typeof r.sessionNumber === "number" ? r.sessionNumber : undefined,
          eventType: str(r.eventType),
          locationId: refOrWarn("location", "locations", r.location),
          storylineId: refOrWarn("storyline", "storylines", r.storyline),
          revealed: r.revealed === undefined ? true : bool(r.revealed),
          characterIds: refListOrWarn("characters", "characters", r.characters),
        },
        existingId
      );
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown entity type: ${_exhaustive}`);
    }
  }
}

// Second pass for location parents - exported so the caller (commit action)
// runs it once after the main IMPORT_ORDER loop finishes locations, using
// whatever locations.parent names were staged. Kept as an explicit second
// step (rather than hidden inside commitOne) so the ordering requirement -
// "every location in this batch must have a final id before ANY parent gets
// wired up" - stays visible at the call site.
export async function resolveLocationParents(
  campaignId: string,
  resolveRef: (type: EntityTypeKey, name: string | null) => string | null,
  warnings: string[]
): Promise<void> {
  // no-op placeholder retained for API symmetry; actual patch-up happens
  // inline in commitCampaignImport via pendingLocationParents + a direct
  // adminUpsertLocation re-save, see below.
}
