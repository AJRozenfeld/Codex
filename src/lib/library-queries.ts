import { getDb, ensureSchema, newId } from "./db";
import type { EquipmentItem, EquipmentDetails, Spell, SpellDetails } from "./types";

// ---------------------------------------------------------------------------
// Equipment & Spell libraries (2026-07-31). Same scoping contract as
// creature-queries.ts: scope = a campaign id, or null = the shared platform
// library (read-only for DMs, master-curated, copyable into campaigns).
// Both entities are simple enough to share one generic core - a name +
// convenience columns + a freeform JSON `details` blob - so the per-entity
// exports below are thin bindings over the same helpers. If a third library
// entity ever appears (vehicles? deities?), extend TABLES and add bindings.
// ---------------------------------------------------------------------------

type Scope = string | null;

function scopeWhere(scope: Scope): { cond: string; args: string[] } {
  return scope === null ? { cond: "campaign_id IS NULL", args: [] } : { cond: "campaign_id = ?", args: [scope] };
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

interface TableSpec {
  table: string;
  /** Column names (beyond id/campaign_id/slug/name/source/details/timestamps). */
  extras: string[];
}

const EQUIPMENT: TableSpec = { table: "equipment_items", extras: ["category", "rarity", "cost", "weight"] };
const SPELLS: TableSpec = { table: "spells", extras: ["level", "school"] };

async function uniqueSlug(spec: TableSpec, scope: Scope, name: string, excludeId?: string): Promise<string> {
  const { cond, args } = scopeWhere(scope);
  const base = slugify(name);
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: `SELECT id FROM ${spec.table} WHERE ${cond} AND slug = ?`, args: [...args, slug] });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

interface GenericRow {
  id: string;
  campaignId: string | null;
  slug: string;
  name: string;
  source: string | null;
  details: Record<string, unknown>;
  [k: string]: unknown;
}

function rowToItem(spec: TableSpec, row: Record<string, unknown>): GenericRow {
  let details: Record<string, unknown>;
  try {
    details = JSON.parse((row.details as string) || "{}");
  } catch {
    details = {};
  }
  const out: GenericRow = {
    id: row.id as string,
    campaignId: (row.campaign_id as string | null) ?? null,
    slug: row.slug as string,
    name: row.name as string,
    source: (row.source as string) ?? null,
    details,
  };
  for (const c of spec.extras) out[c] = row[c] ?? null;
  return out;
}

async function listScoped(spec: TableSpec, campaignId: string): Promise<GenericRow[]> {
  await ensureSchema();
  const order = spec.table === "spells" ? "level ASC, name ASC" : "name ASC";
  const r = await getDb().execute({
    sql: `SELECT * FROM ${spec.table} WHERE campaign_id = ? OR campaign_id IS NULL ORDER BY ${order}`,
    args: [campaignId],
  });
  return r.rows.map((row) => rowToItem(spec, row));
}

async function getScoped(spec: TableSpec, campaignId: string, id: string): Promise<GenericRow | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT * FROM ${spec.table} WHERE id = ? AND (campaign_id = ? OR campaign_id IS NULL)`,
    args: [id, campaignId],
  });
  return r.rows[0] ? rowToItem(spec, r.rows[0]) : null;
}

async function getLibrary(spec: TableSpec, id: string): Promise<GenericRow | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: `SELECT * FROM ${spec.table} WHERE id = ? AND campaign_id IS NULL`, args: [id] });
  return r.rows[0] ? rowToItem(spec, r.rows[0]) : null;
}

interface GenericInput {
  name: string;
  source?: string | null;
  details?: Record<string, unknown>;
  [k: string]: unknown;
}

async function upsertScoped(spec: TableSpec, scope: Scope, input: GenericInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSlug(spec, scope, input.name, id);
  const itemId = id ?? newId();
  const extraVals = spec.extras.map((c) => (input[c] === undefined || input[c] === null || input[c] === "" ? (c === "level" ? 0 : null) : input[c]) as string | number | null);
  const detailsJson = JSON.stringify(input.details ?? {});
  const { cond, args: scopeArgs } = scopeWhere(scope);
  if (id) {
    const sets = spec.extras.map((c) => `${c}=?`).join(", ");
    await db.execute({
      sql: `UPDATE ${spec.table} SET name=?, slug=?, ${sets}, source=?, details=?, updated_at=datetime('now') WHERE id=? AND ${cond}`,
      args: [input.name, slug, ...extraVals, input.source ?? null, detailsJson, id, ...scopeArgs],
    });
  } else {
    const cols = spec.extras.join(", ");
    const qs = spec.extras.map(() => "?").join(",");
    await db.execute({
      sql: `INSERT INTO ${spec.table} (id, campaign_id, name, slug, ${cols}, source, details) VALUES (?,?,?,?,${qs},?,?)`,
      args: [itemId, scope, input.name, slug, ...extraVals, input.source ?? null, detailsJson],
    });
  }
  return itemId;
}

async function deleteScoped(spec: TableSpec, scope: Scope, id: string): Promise<void> {
  await ensureSchema();
  const { cond, args } = scopeWhere(scope);
  await getDb().execute({ sql: `DELETE FROM ${spec.table} WHERE id = ? AND ${cond}`, args: [id, ...args] });
}

async function copyToCampaign(spec: TableSpec, campaignId: string, libraryId: string): Promise<string | null> {
  const src = await getLibrary(spec, libraryId);
  if (!src) return null;
  const input: GenericInput = { name: src.name, source: src.source, details: src.details };
  for (const c of spec.extras) input[c] = src[c];
  return upsertScoped(spec, campaignId, input);
}

export interface BulkLibraryImportResult {
  created: number;
  updated: number;
  errors: { name: string; error: string }[];
}

async function bulkImport(spec: TableSpec, scope: Scope, rows: GenericInput[]): Promise<BulkLibraryImportResult> {
  await ensureSchema();
  const db = getDb();
  const result: BulkLibraryImportResult = { created: 0, updated: 0, errors: [] };
  const { cond, args } = scopeWhere(scope);
  const existing = await db.execute({ sql: `SELECT id, slug FROM ${spec.table} WHERE ${cond}`, args });
  const idBySlug = new Map<string, string>(existing.rows.map((r) => [r.slug as string, r.id as string]));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = row?.name || `row ${i + 1}`;
    try {
      if (!row || typeof row.name !== "string" || !row.name.trim()) throw new Error("Missing required field: name");
      const slug = slugify(row.name);
      const existingId = idBySlug.get(slug);
      const savedId = await upsertScoped(spec, scope, row, existingId);
      idBySlug.set(slug, savedId);
      if (existingId) result.updated++;
      else result.created++;
    } catch (err) {
      result.errors.push({ name: label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

// --------------------------- Equipment bindings ----------------------------

const EQUIPMENT_DETAIL_DEFAULTS: EquipmentDetails = { statLine: "", description: "" };

function toEquipment(r: GenericRow): EquipmentItem {
  return {
    id: r.id, campaignId: r.campaignId, slug: r.slug, name: r.name, source: r.source,
    category: (r.category as string) ?? null,
    rarity: (r.rarity as string) ?? null,
    cost: (r.cost as string) ?? null,
    weight: (r.weight as string) ?? null,
    details: { ...EQUIPMENT_DETAIL_DEFAULTS, ...(r.details as Partial<EquipmentDetails>) },
  };
}

export interface EquipmentInput {
  name: string;
  category?: string | null;
  rarity?: string | null;
  cost?: string | null;
  weight?: string | null;
  source?: string | null;
  details?: Partial<EquipmentDetails>;
}

export async function listEquipment(campaignId: string): Promise<EquipmentItem[]> {
  return (await listScoped(EQUIPMENT, campaignId)).map(toEquipment);
}
export async function getEquipmentItem(campaignId: string, id: string): Promise<EquipmentItem | null> {
  const r = await getScoped(EQUIPMENT, campaignId, id);
  return r ? toEquipment(r) : null;
}
export async function getLibraryEquipmentItem(id: string): Promise<EquipmentItem | null> {
  const r = await getLibrary(EQUIPMENT, id);
  return r ? toEquipment(r) : null;
}
export async function upsertEquipmentItem(campaignId: string, input: EquipmentInput, id?: string): Promise<string> {
  return upsertScoped(EQUIPMENT, campaignId, input as GenericInput, id);
}
/** Master-console only at the call sites. */
export async function upsertLibraryEquipmentItem(input: EquipmentInput, id?: string): Promise<string> {
  return upsertScoped(EQUIPMENT, null, input as GenericInput, id);
}
export async function deleteEquipmentItem(campaignId: string, id: string): Promise<void> {
  return deleteScoped(EQUIPMENT, campaignId, id);
}
/** Master-console only at the call sites. */
export async function deleteLibraryEquipmentItem(id: string): Promise<void> {
  return deleteScoped(EQUIPMENT, null, id);
}
export async function copyLibraryEquipmentToCampaign(campaignId: string, libraryId: string): Promise<string | null> {
  return copyToCampaign(EQUIPMENT, campaignId, libraryId);
}
export async function bulkImportEquipment(scope: string | null, rows: EquipmentInput[]): Promise<BulkLibraryImportResult> {
  return bulkImport(EQUIPMENT, scope, rows as GenericInput[]);
}

// ----------------------------- Spell bindings ------------------------------

const SPELL_DETAIL_DEFAULTS: SpellDetails = {
  castingTime: "", range: "", components: "", duration: "", classes: "",
  description: "", higherLevel: "", ritual: false, concentration: false,
};

function toSpell(r: GenericRow): Spell {
  return {
    id: r.id, campaignId: r.campaignId, slug: r.slug, name: r.name, source: r.source,
    level: Number(r.level ?? 0),
    school: (r.school as string) ?? null,
    details: { ...SPELL_DETAIL_DEFAULTS, ...(r.details as Partial<SpellDetails>) },
  };
}

export interface SpellInput {
  name: string;
  level?: number;
  school?: string | null;
  source?: string | null;
  details?: Partial<SpellDetails>;
}

export async function listSpells(campaignId: string): Promise<Spell[]> {
  return (await listScoped(SPELLS, campaignId)).map(toSpell);
}
export async function getSpell(campaignId: string, id: string): Promise<Spell | null> {
  const r = await getScoped(SPELLS, campaignId, id);
  return r ? toSpell(r) : null;
}
export async function getLibrarySpell(id: string): Promise<Spell | null> {
  const r = await getLibrary(SPELLS, id);
  return r ? toSpell(r) : null;
}
export async function upsertSpell(campaignId: string, input: SpellInput, id?: string): Promise<string> {
  return upsertScoped(SPELLS, campaignId, input as GenericInput, id);
}
/** Master-console only at the call sites. */
export async function upsertLibrarySpell(input: SpellInput, id?: string): Promise<string> {
  return upsertScoped(SPELLS, null, input as GenericInput, id);
}
export async function deleteSpell(campaignId: string, id: string): Promise<void> {
  return deleteScoped(SPELLS, campaignId, id);
}
/** Master-console only at the call sites. */
export async function deleteLibrarySpell(id: string): Promise<void> {
  return deleteScoped(SPELLS, null, id);
}
export async function copyLibrarySpellToCampaign(campaignId: string, libraryId: string): Promise<string | null> {
  return copyToCampaign(SPELLS, campaignId, libraryId);
}
export async function bulkImportSpells(scope: string | null, rows: SpellInput[]): Promise<BulkLibraryImportResult> {
  return bulkImport(SPELLS, scope, rows as GenericInput[]);
}
