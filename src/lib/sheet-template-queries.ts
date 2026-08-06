import { getDb, ensureSchema } from "./db";
import {
  PLATFORM_5E_TEMPLATE_ID,
  SHEET_TEMPLATE_5E,
  sanitizeSheetTemplate,
  type SheetTemplateDef,
} from "./sheet-engine";

// ---------------------------------------------------------------------------
// Sheet template resolution (Sheet Engine Phase A, 2026-08-06).
//
// Which SYSTEM a campaign's character sheets use is a per-campaign choice:
// campaigns.sheet_template_id names a sheet_templates row, or is NULL /
// the fixed PLATFORM_5E_TEMPLATE_ID for the seeded 5e system. The 5e
// template deliberately lives as CODE (SHEET_TEMPLATE_5E in
// sheet-engine.ts), not as a database row - the default path costs ZERO
// extra Turso round trips per sheet render (the 2026-07-14 perf-pass
// lesson), and parity with the pre-engine sheet can never drift via a
// stray row edit. Only custom templates (Phase B authoring) hit the table.
//
// A database template is sanitized on load (a stored blob is a claim, not a
// fact - sanitizeBlueprintSteps doctrine); anything unusable falls back to
// 5e so a broken template can never blank a player's sheet.
// ---------------------------------------------------------------------------

export interface ResolvedSheetTemplate {
  /** PLATFORM_5E_TEMPLATE_ID or a sheet_templates row id. */
  id: string;
  def: SheetTemplateDef;
}

export async function getSheetTemplateRow(id: string): Promise<ResolvedSheetTemplate | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, definition FROM sheet_templates WHERE id = ?",
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;
  try {
    const def = sanitizeSheetTemplate(JSON.parse(row.definition as string));
    return def ? { id: row.id as string, def } : null;
  } catch {
    return null;
  }
}

/** The template a campaign's sheets render through. Never throws, never
 *  returns null - the seeded 5e template is the universal fallback. */
export async function resolveSheetTemplateForCampaign(campaignId: string | null): Promise<ResolvedSheetTemplate> {
  const fallback: ResolvedSheetTemplate = { id: PLATFORM_5E_TEMPLATE_ID, def: SHEET_TEMPLATE_5E };
  if (!campaignId) return fallback;
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT sheet_template_id FROM campaigns WHERE id = ?",
    args: [campaignId],
  });
  const templateId = (r.rows[0]?.sheet_template_id as string | null) ?? null;
  if (!templateId || templateId === PLATFORM_5E_TEMPLATE_ID) return fallback;
  const custom = await getSheetTemplateRow(templateId);
  return custom ?? fallback;
}

// ---------------------------------------------------------------------------
// Phase B (2026-08-06): DM-facing template CRUD + the campaign system
// picker. Everything is dm_id-scoped (template tenancy doctrine); the
// seeded 5e template never lives in the table and can never be edited or
// deleted - it's the floor every campaign can always fall back to.
// ---------------------------------------------------------------------------

import { newId } from "./db";
import { validateSheetTemplate, minimalTemplateDef, fiveETemplateDef, type TemplateIssue } from "./sheet-template-validate";

export interface SheetTemplateListItem {
  id: string;
  slug: string;
  name: string;
  /** Human summary of the system, e.g. "6 abilities · 18 skills". */
  shape: string;
  /** Names of this DM's campaigns currently using it. */
  usedBy: string[];
  /** False when the stored definition no longer sanitizes (renders as 5e fallback). */
  healthy: boolean;
}

async function uniqueSheetTemplateSlug(dmId: string, name: string, excludeId?: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "system";
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM sheet_templates WHERE dm_id = ? AND slug = ?", args: [dmId, slug] });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

export async function listSheetTemplatesForDm(dmId: string): Promise<SheetTemplateListItem[]> {
  await ensureSchema();
  const db = getDb();
  const rows = await db.execute({
    sql: "SELECT id, slug, name, definition FROM sheet_templates WHERE dm_id = ? ORDER BY name ASC",
    args: [dmId],
  });
  const out: SheetTemplateListItem[] = [];
  for (const row of rows.rows) {
    let shape = "unreadable definition";
    let healthy = false;
    try {
      const def = sanitizeSheetTemplate(JSON.parse(row.definition as string));
      if (def) {
        shape = `${def.abilities.length} abilit${def.abilities.length === 1 ? "y" : "ies"} · ${def.skills.length} skill${def.skills.length === 1 ? "" : "s"}`;
        healthy = true;
      }
    } catch {
      /* falls through as unreadable */
    }
    const usedBy = await db.execute({
      sql: "SELECT name FROM campaigns WHERE dm_id = ? AND sheet_template_id = ? ORDER BY name ASC",
      args: [dmId, row.id as string],
    });
    out.push({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      shape,
      usedBy: usedBy.rows.map((c) => c.name as string),
      healthy,
    });
  }
  return out;
}

export async function createSheetTemplate(
  dmId: string,
  rawName: string,
  from: "5e" | "minimal"
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensureSchema();
  const name = rawName.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the system a name." };
  const def = from === "5e" ? fiveETemplateDef(name) : minimalTemplateDef(name);
  const slug = await uniqueSheetTemplateSlug(dmId, name);
  const id = newId();
  await getDb().execute({
    sql: "INSERT INTO sheet_templates (id, dm_id, slug, name, definition) VALUES (?,?,?,?,?)",
    args: [id, dmId, slug, name, JSON.stringify(def)],
  });
  return { ok: true, id };
}

export interface SheetTemplateForEdit {
  id: string;
  name: string;
  def: SheetTemplateDef;
}

/** The template as the editor should see it - sanitized (a stored blob is a
 *  claim), owned by this DM or null. */
export async function getSheetTemplateForEdit(dmId: string, id: string): Promise<SheetTemplateForEdit | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, name, definition FROM sheet_templates WHERE id = ? AND dm_id = ?",
    args: [id, dmId],
  });
  const row = r.rows[0];
  if (!row) return null;
  let def: SheetTemplateDef | null = null;
  try {
    def = sanitizeSheetTemplate(JSON.parse(row.definition as string));
  } catch {
    def = null;
  }
  // An unreadable definition opens as a fresh minimal skeleton rather than
  // refusing to open at all - the DM can rebuild and save over it.
  return { id: row.id as string, name: row.name as string, def: def ?? minimalTemplateDef(row.name as string) };
}

export async function updateSheetTemplate(
  dmId: string,
  id: string,
  rawName: string,
  rawDef: unknown
): Promise<{ ok: true } | { ok: false; error: string; issues?: TemplateIssue[] }> {
  await ensureSchema();
  const db = getDb();
  const owned = await db.execute({ sql: "SELECT id FROM sheet_templates WHERE id = ? AND dm_id = ?", args: [id, dmId] });
  if (!owned.rows[0]) return { ok: false, error: "That sheet system no longer exists." };
  const name = rawName.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the system a name." };
  const def = sanitizeSheetTemplate(rawDef);
  if (!def) return { ok: false, error: "The system needs at least one ability with a valid key." };
  def.name = name;
  const issues = validateSheetTemplate(def);
  if (issues.length > 0) {
    return { ok: false, error: `Fix ${issues.length} issue${issues.length === 1 ? "" : "s"} before saving.`, issues };
  }
  const slug = await uniqueSheetTemplateSlug(dmId, name, id);
  await db.execute({
    sql: "UPDATE sheet_templates SET name = ?, slug = ?, definition = ?, updated_at = datetime('now') WHERE id = ? AND dm_id = ?",
    args: [name, slug, JSON.stringify(def), id, dmId],
  });
  return { ok: true };
}

/** Deletes the template and points any campaign using it back at the seeded
 *  5e system explicitly (no dangling ids, even though dangling is safe). */
export async function deleteSheetTemplate(dmId: string, id: string): Promise<{ deleted: boolean; freedCampaigns: number }> {
  await ensureSchema();
  const db = getDb();
  const owned = await db.execute({ sql: "SELECT id FROM sheet_templates WHERE id = ? AND dm_id = ?", args: [id, dmId] });
  if (!owned.rows[0]) return { deleted: false, freedCampaigns: 0 };
  const freed = await db.execute({
    sql: "UPDATE campaigns SET sheet_template_id = NULL, updated_at = datetime('now') WHERE dm_id = ? AND sheet_template_id = ?",
    args: [dmId, id],
  });
  await db.execute({ sql: "DELETE FROM sheet_templates WHERE id = ? AND dm_id = ?", args: [id, dmId] });
  return { deleted: true, freedCampaigns: Number(freed.rowsAffected ?? 0) };
}

export interface CampaignSheetAssignment {
  campaignId: string;
  campaignName: string;
  /** null = the seeded 5e system. */
  sheetTemplateId: string | null;
  /** How many character sheets exist in the campaign - fuels the switch warning. */
  sheetCount: number;
}

export async function listCampaignSheetAssignments(dmId: string): Promise<CampaignSheetAssignment[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.id, c.name, c.sheet_template_id,
                 (SELECT COUNT(*) FROM character_sheets cs JOIN characters ch ON ch.id = cs.character_id
                  WHERE ch.campaign_id = c.id) AS sheet_count
          FROM campaigns c WHERE c.dm_id = ? ORDER BY c.created_at ASC`,
    args: [dmId],
  });
  return r.rows.map((row) => ({
    campaignId: row.id as string,
    campaignName: row.name as string,
    sheetTemplateId: (row.sheet_template_id as string) ?? null,
    sheetCount: Number(row.sheet_count ?? 0),
  }));
}

/** Points a campaign at a sheet system. templateId null (or the fixed
 *  platform id) = the seeded 5e system. Both the campaign AND the template
 *  must belong to this DM - a foreign id is silently refused. Existing sheet
 *  data is never touched: fields the new system doesn't know simply stop
 *  rendering, and return if the campaign switches back (Aviv's call,
 *  2026-08-06: keep data, warn). */
export async function setCampaignSheetTemplate(
  dmId: string,
  campaignId: string,
  templateId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  const db = getDb();
  const owned = await db.execute({ sql: "SELECT id FROM campaigns WHERE id = ? AND dm_id = ?", args: [campaignId, dmId] });
  if (!owned.rows[0]) return { ok: false, error: "That campaign isn't yours to change." };
  let stored: string | null = templateId;
  if (!templateId || templateId === PLATFORM_5E_TEMPLATE_ID) {
    stored = null;
  } else {
    const t = await db.execute({ sql: "SELECT id FROM sheet_templates WHERE id = ? AND dm_id = ?", args: [templateId, dmId] });
    if (!t.rows[0]) return { ok: false, error: "That sheet system no longer exists." };
  }
  await db.execute({
    sql: "UPDATE campaigns SET sheet_template_id = ?, updated_at = datetime('now') WHERE id = ? AND dm_id = ?",
    args: [stored, campaignId, dmId],
  });
  return { ok: true };
}
