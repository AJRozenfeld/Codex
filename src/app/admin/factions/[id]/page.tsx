import { notFound, redirect } from "next/navigation";
import {
  adminGetFaction,
  adminUpsertFaction,
  adminDeleteFaction,
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
  await adminUpsertFaction(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? ""),
      regionId: String(formData.get("regionId") ?? "") || null,
      description: String(formData.get("description") ?? ""),
      goals: String(formData.get("goals") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
      revealed: formData.get("revealed") === "on",
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/factions");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteFaction(campaignId, id);
  redirect("/admin/factions");
}

export default async function AdminFactionEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [faction, regions, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetFaction(campaignId, params.id),
    adminGetRegions(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("factions", params.id),
  ]);
  if (!isNew && !faction) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Faction" : `Edit: ${faction!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={faction?.name} required />
        <Field label="Type (Guild, Cult, Noble House, Order...)" name="type" defaultValue={faction?.type} required />
        <Select
          label="Region"
          name="regionId"
          defaultValue={faction?.regionId ?? ""}
          options={regions.map((r) => ({ value: r.id, label: r.name }))}
        />
        <TextArea label="Description" name="description" defaultValue={faction?.description} required />
        <TextArea label="Goals" name="goals" defaultValue={faction?.goals ?? ""} rows={3} />
        <TextArea label="DM Notes (private, never shown publicly)" name="notes" defaultValue={faction?.notes ?? ""} rows={3} />
        <RevealedToggle defaultChecked={faction ? faction.revealed : true} />
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
