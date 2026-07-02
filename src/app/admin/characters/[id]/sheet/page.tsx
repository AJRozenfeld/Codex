import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { adminGetCharacter } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getCharacterSheet, saveCharacterSheet } from "@/lib/character-sheet";
import { CharacterSheetForm } from "@/components/CharacterSheetForm";
import type { CharacterSheetData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCharacterSheetPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const character = await adminGetCharacter(campaignId, params.id);
  if (!character) notFound();

  const sheetData = await getCharacterSheet(character.id);

  async function saveAction(formData: FormData) {
    "use server";
    const raw = String(formData.get("sheetData") ?? "{}");
    let parsed: CharacterSheetData;
    try {
      parsed = JSON.parse(raw);
    } catch {
      redirect(`/admin/characters/${params.id}/sheet`);
    }
    await saveCharacterSheet(params.id, parsed!);
    redirect(`/admin/characters/${params.id}/sheet`);
  }

  return (
    <div>
      <Link href={`/admin/characters/${params.id}`} className="text-sm text-parchment/50 hover:text-gold">
        &larr; Back to {character.name}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">Character Sheet: {character.name}</h1>
      </div>
      <CharacterSheetForm characterName={character.name} initialData={sheetData} saveAction={saveAction} />
    </div>
  );
}
