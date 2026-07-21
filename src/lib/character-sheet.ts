import { getDb, ensureSchema, newId } from "./db";
import type { CharacterSheetData } from "./types";
import { defaultCharacterSheet, mergeWithDefaults } from "./character-sheet-shared";

export {
  SKILL_ABILITY,
  SKILL_LABELS,
  defaultCharacterSheet,
  mergeWithDefaults,
  abilityModifier,
  formatModifier,
} from "./character-sheet-shared";

export async function getCharacterSheet(characterId: string): Promise<CharacterSheetData> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT data FROM character_sheets WHERE character_id = ?",
    args: [characterId],
  });
  if (!r.rows[0]) return defaultCharacterSheet();
  try {
    return mergeWithDefaults(JSON.parse(r.rows[0].data as string));
  } catch {
    return defaultCharacterSheet();
  }
}

// ---------------------------------------------------------------------------
// Live patches (play-ready sheet, 2026-07-20). During a session the numbers
// that change constantly - current/temp HP, death saves, spell-slot usage -
// shouldn't require editing a field and re-saving the whole sheet. These
// apply a narrow, clamped delta to just those values and persist instantly,
// returning the updated live subset so the client can reconcile any clamp.
// Ownership is the caller's job (same as roll requests): the page-level
// server action verifies the viewer owns this character before calling.
// ---------------------------------------------------------------------------

export type LiveSheetPatch =
  | { kind: "hp"; current?: number; temp?: number }
  | { kind: "deathSaves"; successes?: number; failures?: number }
  | { kind: "slot"; level: string; used: number }
  | { kind: "longRest" };

export interface LiveSheetState {
  hitPointCurrent: number;
  hitPointTemp: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  spellSlots: Record<string, { total: number; used: number }>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function liveStateOf(s: CharacterSheetData): LiveSheetState {
  return {
    hitPointCurrent: s.hitPointCurrent,
    hitPointTemp: s.hitPointTemp,
    deathSaveSuccesses: s.deathSaveSuccesses,
    deathSaveFailures: s.deathSaveFailures,
    spellSlots: s.spellSlots,
  };
}

export async function patchLiveSheet(characterId: string, patch: LiveSheetPatch): Promise<LiveSheetState> {
  const sheet = await getCharacterSheet(characterId); // merged, always full shape
  switch (patch.kind) {
    case "hp":
      if (patch.current !== undefined) {
        // Current HP floors at 0 and caps at max (a heal can't overfill).
        sheet.hitPointCurrent = clamp(patch.current, 0, Math.max(0, sheet.hitPointMax));
      }
      if (patch.temp !== undefined) sheet.hitPointTemp = clamp(patch.temp, 0, 9999);
      break;
    case "deathSaves":
      if (patch.successes !== undefined) sheet.deathSaveSuccesses = clamp(patch.successes, 0, 3);
      if (patch.failures !== undefined) sheet.deathSaveFailures = clamp(patch.failures, 0, 3);
      break;
    case "slot": {
      const slot = sheet.spellSlots[patch.level];
      if (slot) slot.used = clamp(patch.used, 0, slot.total);
      break;
    }
    case "longRest":
      // A night's rest: full HP, temp cleared, every slot recovered, death
      // saves wiped. (Hit-dice recovery is left to the player - 5e restores
      // only half, and we don't parse the dice pool here yet.)
      sheet.hitPointCurrent = Math.max(0, sheet.hitPointMax);
      sheet.hitPointTemp = 0;
      sheet.deathSaveSuccesses = 0;
      sheet.deathSaveFailures = 0;
      for (const lvl of Object.keys(sheet.spellSlots)) sheet.spellSlots[lvl].used = 0;
      break;
  }
  await saveCharacterSheet(characterId, sheet);
  return liveStateOf(sheet);
}

export async function saveCharacterSheet(characterId: string, data: CharacterSheetData): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const json = JSON.stringify(data);
  const existing = await db.execute({
    sql: "SELECT id FROM character_sheets WHERE character_id = ?",
    args: [characterId],
  });
  if (existing.rows[0]) {
    await db.execute({
      sql: "UPDATE character_sheets SET data = ?, updated_at = datetime('now') WHERE character_id = ?",
      args: [json, characterId],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO character_sheets (id, character_id, data) VALUES (?,?,?)",
      args: [newId(), characterId, json],
    });
  }
}
