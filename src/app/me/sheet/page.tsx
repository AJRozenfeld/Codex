import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { getCharacterSheet, saveCharacterSheet, patchLiveSheet, type LiveSheetPatch } from "@/lib/character-sheet";
import { requestSheetRoll } from "@/lib/roll-requests";
import { CharacterSheetForm } from "@/components/CharacterSheetForm";
import { CharacterSheetView } from "@/components/CharacterSheetView";
import type { CharacterSheetData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyCharacterSheetPage({ searchParams }: { searchParams: { saved?: string; edit?: string } }) {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.id AS character_id, c.name AS character_name, c.portrait_path AS portrait_path
          FROM players p LEFT JOIN characters c ON c.id = p.character_id
          WHERE p.id = ?`,
    args: [session.playerId],
  });
  const row = r.rows[0];
  if (!row || !row.character_id) redirect("/me");

  const characterId = row.character_id as string;
  const characterName = row.character_name as string;
  const portraitPath = (row.portrait_path as string) ?? null;
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
    // Land on the character page (not the form) - the reward for saving is
    // seeing your character, dressed for the occasion.
    await saveCharacterSheet(characterId, parsed!);
    redirect("/me/sheet?saved=1");
  }

  // Roll bridge (2026-07-16): the d20 buttons. Ownership is re-verified
  // inside the action - a player may only ever roll for their own character,
  // no matter what a tampered client sends.
  async function rollAction(target: string): Promise<{ ok: boolean; error?: string }> {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) return { ok: false, error: "Not logged in." };
    const check = await getDb().execute({
      sql: "SELECT character_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    if ((check.rows[0]?.character_id as string | undefined) !== characterId) {
      return { ok: false, error: "Not your character." };
    }
    return requestSheetRoll(characterId, target);
  }

  // Live combat patches (HP/slots/death saves/long rest) - ownership
  // re-verified server-side, same as rolling.
  async function livePatchAction(patch: LiveSheetPatch) {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) throw new Error("Not logged in.");
    const check = await getDb().execute({
      sql: "SELECT character_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    if ((check.rows[0]?.character_id as string | undefined) !== characterId) {
      throw new Error("Not your character.");
    }
    return patchLiveSheet(characterId, patch);
  }

  const editing = Boolean(searchParams?.edit);

  return (
    <div>
      <Link href="/me" className="text-sm text-parchment/50 hover:text-gold">&larr; Back</Link>
      {editing ? (
        <>
          <div className="mt-4 mb-6 flex items-center justify-between">
            <h1 className="font-display text-2xl text-gold">Character Sheet</h1>
            <Link href="/me/sheet" className="text-sm text-gold hover:underline">
              &larr; Back to character view
            </Link>
          </div>
          <CharacterSheetForm characterName={characterName} initialData={sheetData} saveAction={saveAction} rollAction={rollAction} livePatchAction={livePatchAction} />
        </>
      ) : (
        <div className="mt-4">
          <CharacterSheetView
            characterName={characterName}
            portraitPath={portraitPath}
            data={sheetData}
            editHref="/me/sheet?edit=1"
            rollAction={rollAction}
            livePatchAction={livePatchAction}
            saved={Boolean(searchParams?.saved)}
          />
        </div>
      )}
    </div>
  );
}
