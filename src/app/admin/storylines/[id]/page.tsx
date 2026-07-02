import { notFound, redirect } from "next/navigation";
import {
  adminGetStoryline,
  adminUpsertStoryline,
  adminDeleteStoryline,
  adminGetLocations,
  adminGetCharacters,
  adminGetStorylineCharacterIds,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["Active", "Dormant", "Resolved", "Background"];

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertStoryline(
    campaignId,
    {
      title: String(formData.get("title") ?? ""),
      status: String(formData.get("status") ?? "Active"),
      priority: String(formData.get("priority") ?? "") || undefined,
      summary: String(formData.get("summary") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      locationId: String(formData.get("locationId") ?? "") || null,
      nextStep: String(formData.get("nextStep") ?? "") || undefined,
      revealed: formData.get("revealed") === "on",
      characterIds: formData.getAll("characterIds").map(String),
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/storylines");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteStoryline(campaignId, id);
  redirect("/admin/storylines");
}

export default async function AdminStorylineEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [storyline, locations, characters, selectedCharacterIds, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetStoryline(campaignId, params.id),
    adminGetLocations(campaignId),
    adminGetCharacters(campaignId),
    isNew ? Promise.resolve([]) : adminGetStorylineCharacterIds(params.id),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("storylines", params.id),
  ]);
  if (!isNew && !storyline) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Storyline" : `Edit: ${storyline!.title}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Title" name="title" defaultValue={storyline?.title} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Select
            label="Status"
            name="status"
            defaultValue={storyline?.status ?? "Active"}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
            required
          />
          <Field label="Priority (optional)" name="priority" defaultValue={storyline?.priority ?? ""} />
        </div>
        <Select
          label="Centered Location"
          name="locationId"
          defaultValue={storyline?.locationId ?? ""}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        <TextArea label="Short Summary (used in listings)" name="summary" defaultValue={storyline?.summary} rows={2} required />
        <TextArea label="Full Description" name="description" defaultValue={storyline?.description ?? ""} />
        <TextArea label="Next Step (what's coming, shown to players as a teaser)" name="nextStep" defaultValue={storyline?.nextStep ?? ""} rows={3} />
        <CheckboxGroup
          label="Involved Characters"
          name="characterIds"
          options={characters.map((c) => ({ value: c.id, label: c.name }))}
          selected={selectedCharacterIds}
        />
        <RevealedToggle defaultChecked={storyline ? storyline.revealed : false} />
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
