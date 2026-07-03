import { getDb, ensureSchema } from "./db";
import { uploadCharacterPortrait } from "./blob-storage";

// ---------------------------------------------------------------------------
// Player self-service editing of their own character's bio and portrait.
// Deliberately narrow: only these two fields are writable here. Everything
// else about a character (name, class, faction, location, revealed state,
// restricted-player list) stays admin-only via admin-queries.ts. Callers
// MUST verify the requesting player actually owns characterId (via
// players.character_id) before calling updateCharacterProfile - this module
// does not re-check ownership itself, matching the pattern already used by
// character-sheet.ts / the /me/sheet page.
// ---------------------------------------------------------------------------

export interface CharacterProfile {
  id: string;
  name: string;
  bio: string;
  portraitPath: string | null;
}

export async function getCharacterProfile(characterId: string): Promise<CharacterProfile | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, name, bio, portrait_path FROM characters WHERE id = ?",
    args: [characterId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    bio: row.bio as string,
    portraitPath: (row.portrait_path as string) ?? null,
  };
}

export async function updateCharacterProfile(
  characterId: string,
  input: { bio: string; portraitFile?: File | null }
): Promise<void> {
  await ensureSchema();
  const db = getDb();

  let portraitUrl: string | undefined;
  if (input.portraitFile && input.portraitFile.size > 0) {
    portraitUrl = await uploadCharacterPortrait(input.portraitFile);
  }

  if (portraitUrl !== undefined) {
    await db.execute({
      sql: "UPDATE characters SET bio = ?, portrait_path = ?, updated_at = datetime('now') WHERE id = ?",
      args: [input.bio, portraitUrl, characterId],
    });
  } else {
    await db.execute({
      sql: "UPDATE characters SET bio = ?, updated_at = datetime('now') WHERE id = ?",
      args: [input.bio, characterId],
    });
  }
}
