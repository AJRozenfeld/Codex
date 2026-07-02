import { notFound, redirect } from "next/navigation";
import {
  adminGetTimelineEvent,
  adminUpsertTimelineEvent,
  adminDeleteTimelineEvent,
  adminGetLocations,
  adminGetCharacters,
  adminGetStorylines,
  adminGetTimelineEventCharacterIds,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

const EVENT_TYPES = ["Session", "Historical", "Prophecy", "Rumor"];

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertTimelineEvent(
    campaignId,
    {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      inWorldDate: String(formData.get("inWorldDate") ?? "") || undefined,
      sortIndex: Number(formData.get("sortIndex") ?? 0),
      sessionNumber: formData.get("sessionNumber") ? Number(formData.get("sessionNumber")) : undefined,
      eventType: String(formData.get("eventType") ?? "Session"),
      locationId: String(formData.get("locationId") ?? "") || null,
      storylineId: String(formData.get("storylineId") ?? "") || null,
      revealed: formData.get("revealed") === "on",
      characterIds: formData.getAll("characterIds").map(String),
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/timeline");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteTimelineEvent(campaignId, id);
  redirect("/admin/timeline");
}

export default async function AdminTimelineEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [event, locations, characters, storylines, selectedCharacterIds, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetTimelineEvent(campaignId, params.id),
    adminGetLocations(campaignId),
    adminGetCharacters(campaignId),
    adminGetStorylines(campaignId),
    isNew ? Promise.resolve([]) : adminGetTimelineEventCharacterIds(params.id),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("timeline_events", params.id),
  ]);
  if (!isNew && !event) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Timeline Event" : `Edit: ${event!.title}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Title" name="title" defaultValue={event?.title} required />
        <TextArea label="Description" name="description" defaultValue={event?.description} required />
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="In-World Date" name="inWorldDate" defaultValue={event?.inWorldDate ?? ""} />
          <Field label="Session #" name="sessionNumber" type="number" defaultValue={event?.sessionNumber != null ? String(event.sessionNumber) : ""} />
          <Field label="Sort Order" name="sortIndex" type="number" defaultValue={String(event?.sortIndex ?? 0)} required />
        </div>
        <Select
          label="Event Type"
          name="eventType"
          defaultValue={event?.eventType ?? "Session"}
          options={EVENT_TYPES.map((t) => ({ value: t, label: t }))}
          required
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Select
            label="Location"
            name="locationId"
            defaultValue={event?.locationId ?? ""}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
          <Select
            label="Related Storyline"
            name="storylineId"
            defaultValue={event?.storylineId ?? ""}
            options={storylines.map((s) => ({ value: s.id, label: s.title }))}
          />
        </div>
        <CheckboxGroup
          label="Involved Characters"
          name="characterIds"
          options={characters.map((c) => ({ value: c.id, label: c.name }))}
          selected={selectedCharacterIds}
        />
        <RevealedToggle defaultChecked={event ? event.revealed : false} />
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
