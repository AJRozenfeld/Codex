import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { getCharacterProfile, updateCharacterProfile } from "@/lib/character-profile";
import { TextArea } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT character_id FROM players WHERE id = ?",
    args: [session.playerId],
  });
  const characterId = r.rows[0]?.character_id as string | undefined;
  if (!characterId) redirect("/me");

  const profile = await getCharacterProfile(characterId);
  if (!profile) redirect("/me");

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) redirect("/login");
    // Re-verify the character belongs to this exact player before writing -
    // a player must never be able to overwrite someone else's bio/portrait.
    const check = await getDb().execute({
      sql: "SELECT character_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    const ownedCharacterId = check.rows[0]?.character_id as string | undefined;
    if (!ownedCharacterId || ownedCharacterId !== characterId) redirect("/me");

    const bio = String(formData.get("bio") ?? "");
    const portraitFile = formData.get("portrait");
    await updateCharacterProfile(ownedCharacterId, {
      bio,
      portraitFile: portraitFile instanceof File ? portraitFile : null,
    });
    redirect("/me/profile");
  }

  return (
    <div className="max-w-2xl">
      <Link href="/me" className="text-sm text-parchment/50 hover:text-gold">&larr; Back</Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">Edit {profile.name}</h1>
        <p className="text-sm text-parchment/40 mt-1">
          You can update your bio and portrait here. Everything else about your character (name, class, faction,
          location) is managed by your DM.
        </p>
      </div>
      <form action={saveAction} className="space-y-4">
        <div className="flex items-start gap-4">
          {profile.portraitPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.portraitPath}
              alt={profile.name}
              className="h-20 w-20 rounded-lg object-cover border border-gold/20"
            />
          )}
          <label className="block flex-1">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">
              Portrait {profile.portraitPath ? "(leave blank to keep current image)" : ""}
            </span>
            <input
              type="file"
              name="portrait"
              accept="image/*"
              className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
          </label>
        </div>
        <TextArea label="Bio" name="bio" defaultValue={profile.bio} rows={10} required />
        <div className="pt-2">
          <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
