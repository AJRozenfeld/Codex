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
