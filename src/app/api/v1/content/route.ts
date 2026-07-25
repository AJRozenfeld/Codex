import { resolveApiViewer } from "@/lib/api-auth";
import { getDb, ensureSchema } from "@/lib/db";
import {
  getMoons,
  getRegions,
  getLocations,
  getCharacters,
  getFactions,
  getStorylines,
  getArtifacts,
  getTimelineEvents,
  getSections,
} from "@/lib/queries";
import { json, unauthorized, corsPreflight } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/content - the full revealed snapshot of the viewer's campaign,
// in one round trip. The desktop app caches this locally and re-pulls to
// sync; the payload is a campaign's worth of prose, comfortably small.
//
// Every list below goes through the SAME functions the public website pages
// call, with a ViewerContext built from the token - so revealed-filtering,
// per-player entity access, and GM-tag resolution are inherited, not
// reimplemented. Nothing unrevealed can appear here, which also means
// nothing unrevealed can ever land in the app's on-disk cache.
export async function GET(req: Request) {
  const auth = await resolveApiViewer(req);
  if (!auth) return unauthorized();
  const { viewer } = auth;

  // Unassigned player (self-registered, awaiting placement): a valid login
  // with nothing to show yet. The app renders its "await your summons"
  // screen off `assigned: false` instead of an empty codex.
  if (!viewer.campaignId) {
    return json({ assigned: false, campaign: null, generatedAt: new Date().toISOString(), content: null });
  }

  await ensureSchema();
  const campaignRow = await getDb().execute({
    sql: "SELECT id, name, show_moons FROM campaigns WHERE id = ?",
    args: [viewer.campaignId],
  });
  const campaign = campaignRow.rows[0];
  const showMoons = !!campaign?.show_moons;

  const [regions, locations, characters, factions, storylines, artifacts, timeline, sections, moons] =
    await Promise.all([
      getRegions(viewer),
      getLocations(viewer),
      getCharacters(viewer),
      getFactions(viewer),
      getStorylines(viewer),
      getArtifacts(viewer),
      getTimelineEvents(viewer),
      getSections(viewer),
      showMoons ? getMoons(viewer) : Promise.resolve([]),
    ]);

  return json({
    assigned: true,
    campaign: campaign
      ? { id: campaign.id as string, name: (campaign.name as string) ?? null, showMoons }
      : null,
    generatedAt: new Date().toISOString(),
    content: { moons, regions, locations, characters, factions, storylines, artifacts, timeline, sections },
  });
}

export function OPTIONS() {
  return corsPreflight();
}
