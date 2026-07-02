import { getDb, ensureSchema, newId } from "./db";
import type { JournalEntry, JournalCategory } from "./types";

// ---------------------------------------------------------------------------
// Journal read/write layer. This is intentionally separate from queries.ts
// (public, revealed-gated) and admin-queries.ts (DM-only) - journals are a
// third access pattern: private to exactly one owner (the DM always, plus
// the player linked to the owning character, if any). Every function here
// is unauthenticated by itself; the calling page is responsible for
// verifying the viewer is allowed to see/write ownerCharacterId's journal
// before calling anything below (see /admin/characters/[id]/journal and
// /me/journal for the two call sites and their respective checks).
// ---------------------------------------------------------------------------

function rowToJournalEntry(row: any): JournalEntry {
  return {
    id: row.id,
    ownerCharacterId: row.owner_character_id,
    category: row.category as JournalCategory,
    subjectCharacterId: row.subject_character_id ?? null,
    subjectName: row.subject_name ?? null,
    subjectSlug: row.subject_slug ?? null,
    subjectPortraitPath: row.subject_portrait_path ?? null,
    title: row.title ?? null,
    body: row.body ?? "",
    trustValue: row.trust_value != null ? Number(row.trust_value) : null,
    entryDate: row.entry_date ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getJournalEvents(ownerCharacterId: string): Promise<JournalEntry[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT * FROM journal_entries
          WHERE owner_character_id = ? AND category = 'event'
          ORDER BY COALESCE(entry_date, created_at) DESC, created_at DESC`,
    args: [ownerCharacterId],
  });
  return r.rows.map(rowToJournalEntry);
}

export async function getJournalContacts(ownerCharacterId: string): Promise<JournalEntry[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT je.*, c.name AS subject_name, c.slug AS subject_slug, c.portrait_path AS subject_portrait_path
          FROM journal_entries je
          JOIN characters c ON c.id = je.subject_character_id
          WHERE je.owner_character_id = ? AND je.category = 'contact'
          ORDER BY COALESCE(je.entry_date, je.created_at) DESC, je.created_at DESC`,
    args: [ownerCharacterId],
  });
  return r.rows.map(rowToJournalEntry);
}

export interface JournalEntryInput {
  category: JournalCategory;
  subjectCharacterId?: string | null;
  title?: string | null;
  body: string;
  trustValue?: number | null;
  entryDate?: string | null;
}

export async function createJournalEntry(ownerCharacterId: string, input: JournalEntryInput): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const id = newId();
  await db.execute({
    sql: `INSERT INTO journal_entries (id, owner_character_id, category, subject_character_id, title, body, trust_value, entry_date)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      id,
      ownerCharacterId,
      input.category,
      input.category === "contact" ? input.subjectCharacterId ?? null : null,
      input.title ?? null,
      input.body,
      input.category === "contact" ? input.trustValue ?? null : null,
      input.entryDate ?? null,
    ],
  });
  return id;
}

export async function updateJournalEntry(entryId: string, input: JournalEntryInput): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE journal_entries
          SET title=?, body=?, trust_value=?, entry_date=?, updated_at=datetime('now')
          WHERE id=?`,
    args: [
      input.title ?? null,
      input.body,
      input.category === "contact" ? input.trustValue ?? null : null,
      input.entryDate ?? null,
      entryId,
    ],
  });
}

export async function deleteJournalEntry(entryId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM journal_entries WHERE id = ?", args: [entryId] });
}

/** Verifies an entry belongs to the given owner before letting a caller mutate it. */
export async function journalEntryBelongsToOwner(entryId: string, ownerCharacterId: string): Promise<boolean> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT owner_character_id FROM journal_entries WHERE id = ?",
    args: [entryId],
  });
  return r.rows[0]?.owner_character_id === ownerCharacterId;
}
