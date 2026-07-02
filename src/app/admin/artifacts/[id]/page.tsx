import { notFound, redirect } from "next/navigation";
import {
  adminGetArtifact,
  adminUpsertArtifact,
  adminDeleteArtifact,
  adminGetCharacters,
  adminGetLocations,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, Checkbox, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertArtifact(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? ""),
      rarity: String(formData.get("rarity") ?? "") || undefined,
      attunement: formData.get("attunement") === "on",
      ownerCharacterId: String(formData.get("ownerCharacterId") ?? "") || null,
      locationId: String(formData.get("locationId") ?? "") || null,
      description: String(formData.get("description") ?? ""),
      mechanics: String(formData.get("mechanics") ?? "") || undefined,
      revealed: formData.get("revealed") === "on",
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/artifacts");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteArtifact(campaignId, id);
  redirect("/admin/artifacts");
}

export default async function AdminArtifactEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [artifact, characters, locations, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetArtifact(campaignId, params.id),
    adminGetCharacters(campaignId),
    adminGetLocations(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("artifacts", params.id),
  ]);
  if (!isNew && !artifact) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Artifact" : `Edit: ${artifact!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={artifact?.name} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Type (Weapon, Relic, Wondrous Item...)" name="type" defaultValue={artifact?.type} required />
          <Field label="Rarity" name="rarity" defaultValue={artifact?.rarity ?? ""} />
        </div>
        <Checkbox label="Requires Attunement" name="attunement" defaultChecked={artifact?.attunement} />
        <div className="grid sm:grid-cols-2 gap-4">
          <Select
            label="Held By"
            name="ownerCharacterId"
            defaultValue={artifact?.ownerCharacterId ?? ""}
            options={characters.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            label="Location"
            name="locationId"
            defaultValue={artifact?.locationId ?? ""}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
        </div>
        <TextArea label="Description" name="description" defaultValue={artifact?.description} required />
        <TextArea label="Mechanics (rules text, optional)" name="mechanics" defaultValue={artifact?.mechanics ?? ""} rows={4} />
        <RevealedToggle defaultChecked={artifact ? artifact.revealed : false} />
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
