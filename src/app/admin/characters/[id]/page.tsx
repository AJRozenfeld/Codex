import { notFound, redirect } from "next/navigation";
import {
  adminGetCharacter,
  adminUpsertCharacter,
  adminDeleteCharacter,
  adminGetLocations,
  adminGetFactions,
  adminGetCharacterFactionIds,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, Checkbox, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const imageFile = formData.get("portrait");
  try {
    await adminUpsertCharacter(
      campaignId,
      {
        name: String(formData.get("name") ?? ""),
        isPc: formData.get("isPc") === "on",
        isAlive: formData.get("isAlive") === "on",
        race: String(formData.get("race") ?? "") || undefined,
        charClass: String(formData.get("charClass") ?? "") || undefined,
        status: String(formData.get("status") ?? "") || undefined,
        summary: String(formData.get("summary") ?? ""),
        bio: String(formData.get("bio") ?? ""),
        locationId: String(formData.get("locationId") ?? "") || null,
        revealed: formData.get("revealed") === "on",
        factionIds: formData.getAll("factionIds").map(String),
        restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
        imageFile: imageFile instanceof File ? imageFile : null,
        mask: String(formData.get("mask") ?? "") || null,
      },
      id
    );
  } catch (err) {
    // Most likely idx_characters_mask - two characters in this campaign
    // can't share a Discord mask word.
    redirect(`/admin/characters/${id ?? "new"}?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect("/admin/characters");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteCharacter(campaignId, id);
  redirect("/admin/characters");
}

export default async function AdminCharacterEditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [character, locations, factions, players, selectedRestrictedIds, selectedFactionIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetCharacter(campaignId, params.id),
    adminGetLocations(campaignId),
    adminGetFactions(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("characters", params.id),
    isNew ? Promise.resolve([] as string[]) : adminGetCharacterFactionIds(params.id),
  ]);
  if (!isNew && !character) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">{isNew ? "New Character" : `Edit: ${character!.name}`}</h1>
        {!isNew && (
          <div className="flex items-center gap-4">
            <a href={`/admin/characters/${params.id}/sheet`} className="text-sm text-gold hover:underline">
              Character Sheet &rarr;
            </a>
            <a href={`/admin/characters/${params.id}/journal`} className="text-sm text-gold hover:underline">
              Journal &rarr;
            </a>
          </div>
        )}
      </div>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={character?.name} required />
        <div className="flex gap-6">
          <Checkbox label="Player Character" name="isPc" defaultChecked={character?.isPc} />
          <Checkbox label="Alive" name="isAlive" defaultChecked={character ? character.isAlive : true} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Race" name="race" defaultValue={character?.race ?? ""} />
          <Field label="Class" name="charClass" defaultValue={character?.charClass ?? ""} />
        </div>
        <Field label="Status (e.g. Missing, Imprisoned, In Hiding)" name="status" defaultValue={character?.status ?? ""} />
        {searchParams?.error && <p className="text-sm text-blood">{searchParams.error}</p>}
        <Field
          label="Discord Mask (bracket word, e.g. Bramblefoot)"
          name="mask"
          defaultValue={character?.mask ?? ""}
          placeholder="Only the DM can use NPC masks; players set their own on /me/profile"
        />
        <Select
          label="Location"
          name="locationId"
          defaultValue={character?.locationId ?? ""}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        <div className="flex items-start gap-4">
          {character?.portraitPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.portraitPath}
              alt={character.name}
              className="h-20 w-20 rounded-lg object-cover border border-gold/20"
            />
          )}
          <label className="block flex-1">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">
              Portrait {character?.portraitPath ? "(leave blank to keep current image)" : ""}
            </span>
            <input
              type="file"
              name="portrait"
              accept="image/*"
              className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
          </label>
        </div>
        <TextArea label="Short Summary (used in listings)" name="summary" defaultValue={character?.summary} rows={2} required />
        <TextArea label="Full Bio" name="bio" defaultValue={character?.bio} required />
        <CheckboxGroup
          label="Faction Affiliations"
          name="factionIds"
          options={factions.map((f) => ({ value: f.id, label: f.name }))}
          selected={selectedFactionIds}
        />
        <RevealedToggle defaultChecked={character ? character.revealed : false} />
        <CheckboxGroup
          label="Restrict to specific players (leave empty = visible to every player)"
          name="restrictedPlayerIds"
          options={players.map((p) => ({ value: p.id, label: p.displayName }))}
          selected={selectedRestrictedIds}
        />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>
    </div>
  );
}
