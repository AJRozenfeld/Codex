import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { getCharacterSheet, saveCharacterSheet } from "@/lib/character-sheet";
import { CharacterSheetForm } from "@/components/CharacterSheetForm";
import type { CharacterSheetData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyCharacterSheetPage() {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.id AS character_id, c.name AS character_name
          FROM players p LEFT JOIN characters c ON c.id = p.character_id
          WHERE p.id = ?`,
    args: [session.playerId],
  });
  const row = r.rows[0];
  if (!row || !row.character_id) redirect("/me");

  const characterId = row.character_id as string;
  const characterName = row.character_name as string;
  const sheetData = await getCharacterSheet(characterId);

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) redirect("/login");
    // Re-verify the character belongs to this exact player before writing -
    // a player must never be able to overwrite someone else's sheet.
    const check = await getDb().execute({
      sql: "SELECT character_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    const ownedCharacterId = check.rows[0]?.character_id as string | undefined;
    if (!ownedCharacterId || ownedCharacterId !== characterId) redirect("/me");

    const raw = String(formData.get("sheetData") ?? "{}");
    let parsed: CharacterSheetData;
    try {
      parsed = JSON.parse(raw);
    } catch {
      redirect("/me/sheet");
    }
    await saveCharacterSheet(characterId, parsed!);
    redirect("/me/sheet");
  }

  return (
    <div>
      <Link href="/me" className="text-sm text-parchment/50 hover:text-gold">&larr; Back</Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">Character Sheet</h1>
      </div>
      <CharacterSheetForm characterName={characterName} initialData={sheetData} saveAction={saveAction} />
    </div>
  );
}
