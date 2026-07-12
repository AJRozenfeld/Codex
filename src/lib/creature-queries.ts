import { getDb, ensureSchema, newId } from "./db";
import type { Creature, MonsterStatBlock } from "./types";
import { defaultStatBlock, mergeStatBlockWithDefaults } from "./monster-stat-block-shared";

// ---------------------------------------------------------------------------
// The Bestiary (2026-07-12). Started as a lightweight "Creature" concept
// built purely for Scenes (discord-io.ts still owns the Scenes-side
// add/remove-from-scene functions, since those are scene_creatures rows, not
// creatures rows), then expanded the same day into a full 5e stat-block
// library so Aviv can browse/search/import monsters independent of any
// scene, and so a Scene's "from library" picker has real content to pick
// from. Moved out of discord-io.ts (which is meant for Discord-bot-support
// queries specifically) into its own file since this is now a general
// reference feature, not bot-specific - mirrors the character-sheet.ts /
// character-sheet-shared.ts split for the same "big JSON blob" reason.
// ---------------------------------------------------------------------------

async function uniqueCreatureSlug(campaignId: string, name: string, excludeId?: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "creature";
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM creatures WHERE campaign_id = ? AND slug = ?", args: [campaignId, slug] });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

function rowToCreature(row: Record<string, unknown>): Creature {
  let statBlock: MonsterStatBlock;
  try {
    statBlock = mergeStatBlockWithDefaults(JSON.parse((row.stat_block as string) || "{}"));
  } catch {
    statBlock = defaultStatBlock();
  }
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    hp: row.hp === null || row.hp === undefined ? null : Number(row.hp),
    ac: row.ac === null || row.ac === undefined ? null : Number(row.ac),
    initBonus: Number(row.init_bonus ?? 0),
    notes: (row.notes as string) ?? null,
    portraitPath: (row.portrait_path as string) ?? null,
    source: (row.source as string) ?? null,
    statBlock,
  };
}

export async function listCreatures(campaignId: string): Promise<Creature[]> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM creatures WHERE campaign_id = ? ORDER BY name ASC", args: [campaignId] });
  return r.rows.map(rowToCreature);
}

/** Lightweight rows for list/search views - avoids parsing every stat_block blob just to render a table. */
export interface CreatureSummary {
  id: string;
  slug: string;
  name: string;
  creatureType: string;
  challengeRating: string;
  hp: number | null;
  ac: number | null;
  portraitPath: string | null;
  source: string | null;
}

export async function listCreatureSummaries(campaignId: string): Promise<CreatureSummary[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, slug, name, hp, ac, portrait_path, source, stat_block FROM creatures WHERE campaign_id = ? ORDER BY name ASC",
    args: [campaignId],
  });
  return r.rows.map((row) => {
    let creatureType = "";
    let challengeRating = "";
    try {
      const parsed = JSON.parse((row.stat_block as string) || "{}");
      creatureType = parsed.creatureType ?? "";
      challengeRating = parsed.challengeRating ?? "";
    } catch {
      // leave blank
    }
    return {
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      creatureType,
      challengeRating,
      hp: row.hp === null || row.hp === undefined ? null : Number(row.hp),
      ac: row.ac === null || row.ac === undefined ? null : Number(row.ac),
      portraitPath: (row.portrait_path as string) ?? null,
      source: (row.source as string) ?? null,
    };
  });
}

export async function getCreature(campaignId: string, id: string): Promise<Creature | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM creatures WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
  const row = r.rows[0];
  return row ? rowToCreature(row) : null;
}

export interface CreatureInput {
  name: string;
  hp?: number | null;
  ac?: number | null;
  initBonus?: number;
  notes?: string;
  portraitPath?: string | null;
  source?: string | null;
  statBlock?: Partial<MonsterStatBlock>;
}

export async function upsertCreature(campaignId: string, input: CreatureInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueCreatureSlug(campaignId, input.name, id);
  const creatureId = id ?? newId();
  const statBlockJson = JSON.stringify(mergeStatBlockWithDefaults(input.statBlock ?? {}));
  const args = [
    input.name,
    slug,
    input.hp ?? null,
    input.ac ?? null,
    input.initBonus ?? 0,
    input.notes ?? null,
    input.portraitPath ?? null,
    input.source ?? null,
    statBlockJson,
  ];
  if (id) {
    await db.execute({
      sql: `UPDATE creatures SET name=?, slug=?, hp=?, ac=?, init_bonus=?, notes=?, portrait_path=?, source=?, stat_block=?, updated_at=datetime('now')
            WHERE id=? AND campaign_id=?`,
      args: [...args, id, campaignId],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO creatures (id, campaign_id, name, slug, hp, ac, init_bonus, notes, portrait_path, source, stat_block)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [creatureId, campaignId, ...args],
    });
  }
  return creatureId;
}

export async function deleteCreature(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM creatures WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}

// ---------------------------------------------------------------------------
// Bulk import (2026-07-12) - built for seeding the SRD 5.1 monster list, but
// written as a generic "array of CreatureInput-shaped rows in, per-row
// created/updated/error report out" pipeline so the same shape (parse a
// JSON array -> validate each row -> upsert by slug -> collect a result per
// row) is the template for the equipment/spell importers Aviv wants later -
// see /admin/creatures/import/page.tsx for the upload UI this backs.
// ---------------------------------------------------------------------------

export interface CreatureImportRow extends CreatureInput {
  /** Only used to produce a readable error message if this row fails - not stored. */
  __row?: number;
}

export interface BulkImportResult {
  created: number;
  updated: number;
  errors: { name: string; error: string }[];
}

export async function bulkImportCreatures(campaignId: string, rows: CreatureImportRow[]): Promise<BulkImportResult> {
  await ensureSchema();
  const db = getDb();
  const result: BulkImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = row?.name || `row ${i + 1}`;
    try {
      if (!row || typeof row.name !== "string" || !row.name.trim()) {
        throw new Error("Missing required field: name");
      }
      const existing = await db.execute({
        sql: "SELECT id FROM creatures WHERE campaign_id = ? AND slug = ?",
        args: [campaignId, row.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "creature"],
      });
      const existingId = existing.rows[0]?.id as string | undefined;
      await upsertCreature(campaignId, row, existingId);
      if (existingId) result.updated++;
      else result.created++;
    } catch (err) {
      result.errors.push({ name: label, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
