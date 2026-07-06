import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { getCharacterProfile, updateCharacterProfile, setCharacterMask } from "@/lib/character-profile";
import { generatePlayerLinkCode } from "@/lib/discord-io";
import { TextArea, Field } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function verifyOwnedCharacterId(): Promise<string> {
  const activeSession = await getPlayerSession();
  if (!activeSession.playerId) redirect("/login");
  const check = await getDb().execute({
    sql: "SELECT character_id FROM players WHERE id = ?",
    args: [activeSession.playerId],
  });
  const ownedCharacterId = check.rows[0]?.character_id as string | undefined;
  if (!ownedCharacterId) redirect("/me");
  return ownedCharacterId;
}

export default async function MyProfilePage({ searchParams }: { searchParams: { code?: string; error?: string } }) {
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

  const playerRow = await getDb().execute({
    sql: "SELECT discord_user_id FROM players WHERE id = ?",
    args: [session.playerId],
  });
  const discordLinked = !!playerRow.rows[0]?.discord_user_id;

  async function saveAction(formData: FormData) {
    "use server";
    // Re-verify the character belongs to this exact player before writing -
    // a player must never be able to overwrite someone else's bio/portrait.
    const ownedCharacterId = await verifyOwnedCharacterId();

    const bio = String(formData.get("bio") ?? "");
    const portraitFile = formData.get("portrait");
    await updateCharacterProfile(ownedCharacterId, {
      bio,
      portraitFile: portraitFile instanceof File ? portraitFile : null,
    });
    redirect("/me/profile");
  }

  async function saveMaskAction(formData: FormData) {
    "use server";
    const ownedCharacterId = await verifyOwnedCharacterId();
    const mask = String(formData.get("mask") ?? "");
    try {
      await setCharacterMask(ownedCharacterId, mask);
    } catch {
      redirect("/me/profile?error=mask-taken");
    }
    redirect("/me/profile");
  }

  async function generateCodeAction() {
    "use server";
    const activeSession = await getPlayerSession();
    if (!activeSession.playerId) redirect("/login");
    const row = await getDb().execute({
      sql: "SELECT campaign_id FROM players WHERE id = ?",
      args: [activeSession.playerId],
    });
    const activeCampaignId = row.rows[0]?.campaign_id as string | undefined;
    if (!activeCampaignId) redirect("/login");
    const { code } = await generatePlayerLinkCode(activeCampaignId, activeSession.playerId);
    redirect(`/me/profile?code=${code}`);
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

      <div className="mt-10 pt-6 border-t border-gold/20">
        <h2 className="font-display text-lg text-gold mb-1">Discord</h2>
        <p className="text-sm text-parchment/40 mb-4">
          Set a mask so you can speak and roll as {profile.name} in Discord, and link your Discord account so only
          you can use it.
        </p>

        {searchParams?.error === "mask-taken" && (
          <p className="text-sm text-blood mb-3">That mask is already in use by another character in this campaign - pick a different word.</p>
        )}

        <form action={saveMaskAction} className="flex items-end gap-3 mb-6">
          <div className="flex-1">
            <Field
              label="Mask"
              name="mask"
              defaultValue={profile.mask ?? ""}
              placeholder="e.g. Kaelen"
            />
          </div>
          <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold mb-0.5">
            Save Mask
          </button>
        </form>
        <p className="text-xs text-parchment/40 -mt-4 mb-6">
          In Discord: <code className="text-gold/80">[[{profile.mask || "yourmask"}]]: message</code> speaks as{" "}
          {profile.name}. Add <code className="text-gold/80">*roll strength*</code> (or any skill/ability) inside the
          message to roll using your sheet.
        </p>

        {discordLinked ? (
          <p className="text-sm text-parchment/60">Your Discord account is linked.</p>
        ) : searchParams?.code ? (
          <div className="rounded-lg border border-gold/30 bg-void p-4">
            <p className="text-sm text-parchment/60 mb-2">
              In your Discord server, run:
            </p>
            <code className="block text-gold text-lg tracking-widest">/link code:{searchParams.code}</code>
            <p className="text-xs text-parchment/40 mt-2">This code expires in 15 minutes.</p>
          </div>
        ) : (
          <form action={generateCodeAction}>
            <button type="submit" className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm font-medium hover:bg-gold/10">
              Link Discord Account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
