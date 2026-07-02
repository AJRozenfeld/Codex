import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import {
  getJournalEvents,
  getJournalContacts,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  journalEntryBelongsToOwner,
} from "@/lib/journal-queries";
import { JournalBoard } from "@/components/JournalBoard";

export const dynamic = "force-dynamic";

export default async function MyJournalPage() {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT c.id AS character_id, c.name AS character_name, p.campaign_id AS campaign_id
          FROM players p LEFT JOIN characters c ON c.id = p.character_id
          WHERE p.id = ?`,
    args: [session.playerId],
  });
  const row = r.rows[0];
  if (!row || !row.character_id) redirect("/me");

  const characterId = row.character_id as string;
  const characterName = row.character_name as string;
  const campaignId = row.campaign_id as string;

  // Scoped to this player's own campaign - otherwise a player could pick a
  // "contact" character belonging to a different campaign entirely.
  const [events, contacts, allCharacters] = await Promise.all([
    getJournalEvents(characterId),
    getJournalContacts(characterId),
    db.execute({
      sql: "SELECT id, name, slug, portrait_path FROM characters WHERE campaign_id = ? ORDER BY is_pc DESC, name ASC",
      args: [campaignId],
    }),
  ]);
  const otherCharacters = allCharacters.rows
    .filter((c) => (c.id as string) !== characterId)
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      slug: c.slug as string,
      portraitPath: (c.portrait_path as string) ?? null,
    }));

  // Every server action here re-verifies the caller's own session (not just
  // the characterId captured in this closure) and re-derives ownership from
  // it, so a stale or forged call can never write to a different player's
  // journal even if the client-side code were tampered with.
  async function assertOwnCharacter(): Promise<string | null> {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) return null;
    const check = await getDb().execute({
      sql: "SELECT character_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    return (check.rows[0]?.character_id as string | undefined) ?? null;
  }

  async function createEntryAction(
    category: "event" | "contact",
    subjectCharacterId: string | null,
    title: string,
    body: string,
    trustValue: number | null,
    entryDate: string
  ): Promise<string> {
    "use server";
    const ownedCharacterId = await assertOwnCharacter();
    if (!ownedCharacterId) redirect("/login");
    return createJournalEntry(ownedCharacterId, {
      category,
      subjectCharacterId,
      title: title || null,
      body,
      trustValue,
      entryDate: entryDate || null,
    });
  }

  async function updateEntryAction(
    entryId: string,
    category: "event" | "contact",
    title: string,
    body: string,
    trustValue: number | null,
    entryDate: string
  ): Promise<void> {
    "use server";
    const ownedCharacterId = await assertOwnCharacter();
    if (!ownedCharacterId) redirect("/login");
    const owns = await journalEntryBelongsToOwner(entryId, ownedCharacterId);
    if (!owns) return;
    await updateJournalEntry(entryId, { category, title: title || null, body, trustValue, entryDate: entryDate || null });
  }

  async function deleteEntryAction(entryId: string): Promise<void> {
    "use server";
    const ownedCharacterId = await assertOwnCharacter();
    if (!ownedCharacterId) redirect("/login");
    const owns = await journalEntryBelongsToOwner(entryId, ownedCharacterId);
    if (!owns) return;
    await deleteJournalEntry(entryId);
  }

  return (
    <div>
      <Link href="/me" className="text-sm text-parchment/50 hover:text-gold">&larr; Back</Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">{characterName}&rsquo;s Journal</h1>
      </div>
      <JournalBoard
        ownerName={characterName}
        initialEvents={events}
        initialContacts={contacts}
        otherCharacters={otherCharacters}
        createEntryAction={createEntryAction}
        updateEntryAction={updateEntryAction}
        deleteEntryAction={deleteEntryAction}
      />
    </div>
  );
}
