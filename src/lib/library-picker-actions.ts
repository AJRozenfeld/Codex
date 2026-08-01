"use server";

import { getDb, ensureSchema } from "./db";
import { isAdminAuthed } from "./auth";
import { getCurrentPlayerId } from "./player-session";
import { getCurrentCampaignId } from "./campaign-queries";

// ---------------------------------------------------------------------------
// Search actions behind the LibraryPicker modal (2026-07-31). Called from
// client components (character sheet editor, scene composer), so they carry
// their own auth: any admin OR player session may search - the SRD libraries
// are shared content, and players legitimately search spells/weapons while
// editing their sheets. Results carry enough payload to prefill an entry
// client-side without a second round trip.
// ---------------------------------------------------------------------------

export interface PickerItem {
  id: string;
  name: string;
  /** One-line context shown under the name, e.g. "CR 5 · Monstrosity". */
  meta: string;
  /** Spell level (spells only). */
  level?: number;
  /** Prefill text - composed casting stats + description for spells, statLine for weapons. */
  text?: string;
}

const PAGE = 50;

async function authed(): Promise<boolean> {
  if (await isAdminAuthed()) return true;
  return !!(await getCurrentPlayerId());
}

function like(q: string): string {
  return `%${q.trim().replace(/[%_]/g, "")}%`;
}

/** Platform-library spells by name. */
export async function searchLibrarySpells(q: string): Promise<PickerItem[]> {
  if (!(await authed())) return [];
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT id, name, level, school, details FROM spells WHERE campaign_id IS NULL AND name LIKE ? ORDER BY level, name LIMIT ${PAGE}`,
    args: [like(q)],
  });
  return r.rows.map((row) => {
    let text = "";
    try {
      const d = JSON.parse((row.details as string) || "{}");
      text = [d.castingTime && `Casting: ${d.castingTime}`, d.range && `Range: ${d.range}`, d.duration && `Duration: ${d.duration}`, d.description]
        .filter(Boolean).join("\n");
    } catch { /* ignore */ }
    const lvl = Number(row.level ?? 0);
    return {
      id: row.id as string,
      name: row.name as string,
      meta: `${lvl === 0 ? "Cantrip" : `Level ${lvl}`}${row.school ? ` · ${row.school}` : ""}`,
      level: lvl,
      text,
    };
  });
}

/** Platform-library weapons (equipment with category Weapon) by name. */
export async function searchLibraryWeapons(q: string): Promise<PickerItem[]> {
  if (!(await authed())) return [];
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT id, name, cost, details FROM equipment_items WHERE campaign_id IS NULL AND category = 'Weapon' AND name LIKE ? ORDER BY name LIMIT ${PAGE}`,
    args: [like(q)],
  });
  return r.rows.map((row) => {
    let statLine = "";
    try { statLine = (JSON.parse((row.details as string) || "{}").statLine as string) ?? ""; } catch { /* ignore */ }
    return {
      id: row.id as string,
      name: row.name as string,
      meta: [statLine, row.cost as string].filter(Boolean).join(" · "),
      text: statLine,
    };
  });
}

/** Creatures visible to the CURRENT campaign (its own + the platform library) - admin only. */
export async function searchCreaturesForCampaign(q: string): Promise<PickerItem[]> {
  if (!(await isAdminAuthed())) return [];
  await ensureSchema();
  const campaignId = await getCurrentCampaignId();
  const r = await getDb().execute({
    sql: `SELECT id, campaign_id, name, hp, ac, stat_block FROM creatures
          WHERE (campaign_id = ? OR campaign_id IS NULL) AND name LIKE ? ORDER BY name LIMIT ${PAGE}`,
    args: [campaignId, like(q)],
  });
  return r.rows.map((row) => {
    let cr = "", type = "";
    try {
      const sb = JSON.parse((row.stat_block as string) || "{}");
      cr = sb.challengeRating ?? ""; type = sb.creatureType ?? "";
    } catch { /* ignore */ }
    const scope = row.campaign_id === null ? "Library" : "Yours";
    return {
      id: row.id as string,
      name: row.name as string,
      meta: [cr && `CR ${cr}`, type, `HP ${row.hp ?? "?"} / AC ${row.ac ?? "?"}`, scope].filter(Boolean).join(" · "),
    };
  });
}
