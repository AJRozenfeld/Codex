import { notFound, redirect } from "next/navigation";
import {
  adminGetLocation,
  adminUpsertLocation,
  adminDeleteLocation,
  adminGetLocations,
  adminGetRegions,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertLocation(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? ""),
      parentId: String(formData.get("parentId") ?? "") || null,
      regionId: String(formData.get("regionId") ?? "") || null,
      description: String(formData.get("description") ?? ""),
      revealed: formData.get("revealed") === "on",
      notes: String(formData.get("notes") ?? "") || undefined,
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/locations");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteLocation(campaignId, id);
  redirect("/admin/locations");
}

export default async function AdminLocationEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [location, allLocations, regions, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetLocation(campaignId, params.id),
    adminGetLocations(campaignId),
    adminGetRegions(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("locations", params.id),
  ]);
  if (!isNew && !location) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);
  const otherLocations = allLocations.filter((l) => l.id !== params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Location" : `Edit: ${location!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={location?.name} required />
        <Field label="Type (City, Ruin, Fortress, Forest...)" name="type" defaultValue={location?.type} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Select
            label="Parent Location (optional)"
            name="parentId"
            defaultValue={location?.parentId ?? ""}
            options={otherLocations.map((l) => ({ value: l.id, label: l.name }))}
          />
          <Select
            label="Region"
            name="regionId"
            defaultValue={location?.regionId ?? ""}
            options={regions.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>
        <TextArea label="Description" name="description" defaultValue={location?.description} required />
        <TextArea label="DM Notes (private, never shown publicly)" name="notes" defaultValue={location?.notes ?? ""} rows={3} />
        <RevealedToggle defaultChecked={location ? location.revealed : true} />
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
