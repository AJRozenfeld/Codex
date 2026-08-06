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
