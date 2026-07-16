import { redirect } from "next/navigation";
import { adminGetCampaigns, adminCreateCampaign, setCurrentCampaignId, type InheritSelections } from "@/lib/campaign-queries";
import {
  adminGetMoons,
  adminGetRegions,
  adminGetLocations,
  adminGetFactions,
  adminGetCharacters,
  adminGetStorylines,
  adminGetArtifacts,
  adminGetTimelineEvents,
  adminGetMaps,
} from "@/lib/admin-queries";
import { INHERITABLE_ENTITY_TYPES, type InheritableEntityType } from "@/lib/types";
import { NewCampaignForm, type EntityOption } from "@/components/NewCampaignForm";

export const dynamic = "force-dynamic";

async function loadEntityOptions(campaignId: string): Promise<Partial<Record<InheritableEntityType, EntityOption[]>>> {
  const [moons, regions, locations, factions, characters, storylines, artifacts, timelineEvents, maps] =
    await Promise.all([
      adminGetMoons(campaignId),
      adminGetRegions(campaignId),
      adminGetLocations(campaignId),
      adminGetFactions(campaignId),
      adminGetCharacters(campaignId),
      adminGetStorylines(campaignId),
      adminGetArtifacts(campaignId),
      adminGetTimelineEvents(campaignId),
      adminGetMaps(campaignId),
    ]);
  return {
    moons: moons.map((m) => ({ id: m.id, label: m.name })),
    regions: regions.map((r) => ({ id: r.id, label: r.name })),
    locations: locations.map((l) => ({ id: l.id, label: l.name })),
    factions: factions.map((f) => ({ id: f.id, label: f.name })),
    characters: characters.map((c) => ({ id: c.id, label: c.name })),
    storylines: storylines.map((s) => ({ id: s.id, label: s.title })),
    artifacts: artifacts.map((a) => ({ id: a.id, label: a.name })),
    timeline_events: timelineEvents.map((t) => ({ id: t.id, label: t.title })),
    maps: maps.map((m) => ({ id: m.id, label: m.name })),
  };
}

async function createAction(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const inheritFrom = String(formData.get("inheritFrom") ?? "") || null;

  const inheritSelections: InheritSelections = {};
  for (const type of INHERITABLE_ENTITY_TYPES) {
    const ids = formData.getAll(`sel_${type}`).map(String);
    if (ids.length > 0) inheritSelections[type] = ids;
  }

  let campaign;
  try {
    campaign = await adminCreateCampaign({
      name,
      inheritFromCampaignId: inheritFrom,
      inheritSelections,
    });
  } catch (err) {
    // Most likely the license's campaign quota.
    redirect(`/admin/campaigns/new?error=${encodeURIComponent((err as Error).message)}`);
  }

  // Switch straight into the new campaign so the DM lands somewhere useful.
  await setCurrentCampaignId(campaign.id);
  redirect("/admin");
}

export default async function NewCampaignPage({ searchParams }: { searchParams: { error?: string } }) {
  const campaigns = await adminGetCampaigns();
  const entitiesByCampaign: Record<string, Partial<Record<InheritableEntityType, EntityOption[]>>> = {};
  await Promise.all(
    campaigns.map(async (c) => {
      entitiesByCampaign[c.id] = await loadEntityOptions(c.id);
    })
  );

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">New Campaign</h1>
      {searchParams?.error && <p className="text-sm text-blood mb-4">{searchParams.error}</p>}
      <NewCampaignForm
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        entitiesByCampaign={entitiesByCampaign}
        createAction={createAction}
      />
    </div>
  );
}
