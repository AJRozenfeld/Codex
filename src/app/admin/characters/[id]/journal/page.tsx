import { notFound } from "next/navigation";
import Link from "next/link";
import { adminGetCharacter, adminGetCharacters } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
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

export default async function AdminCharacterJournalPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const character = await adminGetCharacter(campaignId, params.id);
  if (!character) notFound();

  const [events, contacts, allCharacters] = await Promise.all([
    getJournalEvents(params.id),
    getJournalContacts(params.id),
    adminGetCharacters(campaignId),
  ]);
  const otherCharacters = allCharacters
    .filter((c) => c.id !== params.id)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, portraitPath: c.portraitPath ?? null }));

  async function createEntryAction(
    category: "event" | "contact",
    subjectCharacterId: string | null,
    title: string,
    body: string,
    trustValue: number | null,
    entryDate: string
  ): Promise<string> {
    "use server";
    return createJournalEntry(params.id, {
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
    const owns = await journalEntryBelongsToOwner(entryId, params.id);
    if (!owns) return;
    await updateJournalEntry(entryId, { category, title: title || null, body, trustValue, entryDate: entryDate || null });
  }

  async function deleteEntryAction(entryId: string): Promise<void> {
    "use server";
    const owns = await journalEntryBelongsToOwner(entryId, params.id);
    if (!owns) return;
    await deleteJournalEntry(entryId);
  }

  return (
    <div>
      <Link href={`/admin/characters/${params.id}`} className="text-sm text-parchment/50 hover:text-gold">
        &larr; Back to {character.name}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">{character.name}&rsquo;s Journal</h1>
      </div>
      <JournalBoard
        ownerName={character.name}
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
