import { notFound, redirect } from "next/navigation";
import {
  adminGetRegion,
  adminUpsertRegion,
  adminDeleteRegion,
  adminGetMoons,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertRegion(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? ""),
      capital: String(formData.get("capital") ?? "") || undefined,
      government: String(formData.get("government") ?? "") || undefined,
      faith: String(formData.get("faith") ?? "") || undefined,
      moonId: String(formData.get("moonId") ?? "") || null,
      description: String(formData.get("description") ?? ""),
      color: String(formData.get("color") ?? "") || undefined,
      sortOrder: Number(formData.get("sortOrder") ?? 0),
      revealed: formData.get("revealed") === "on",
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/regions");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteRegion(campaignId, id);
  redirect("/admin/regions");
}

export default async function AdminRegionEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [region, moons, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetRegion(campaignId, params.id),
    adminGetMoons(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("regions", params.id),
  ]);
  if (!isNew && !region) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Region" : `Edit: ${region!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={region?.name} required />
        <Field label="Type (Kingdom, Wilderness, City-State...)" name="type" defaultValue={region?.type} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Capital" name="capital" defaultValue={region?.capital ?? ""} />
          <Field label="Government" name="government" defaultValue={region?.government ?? ""} />
        </div>
        <Field label="Dominant Faith" name="faith" defaultValue={region?.faith ?? ""} />
        <Select
          label="Patron Moon"
          name="moonId"
          defaultValue={region?.moonId ?? ""}
          options={moons.map((m) => ({ value: m.id, label: m.name }))}
        />
        <TextArea label="Description" name="description" defaultValue={region?.description} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Color (hex, optional)" name="color" defaultValue={region?.color ?? ""} />
          <Field label="Sort order" name="sortOrder" type="number" defaultValue={String(region?.sortOrder ?? 0)} />
        </div>
        <RevealedToggle defaultChecked={region ? region.revealed : true} />
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
