import Link from "next/link";
import {
  adminGetMoons,
  adminGetRegions,
  adminGetLocations,
  adminGetCharacters,
  adminGetFactions,
  adminGetStorylines,
  adminGetArtifacts,
  adminGetTimelineEvents,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const campaignId = await getCurrentCampaignId();
  const [moons, regions, locations, characters, factions, storylines, artifacts, events] = await Promise.all([
    adminGetMoons(campaignId),
    adminGetRegions(campaignId),
    adminGetLocations(campaignId),
    adminGetCharacters(campaignId),
    adminGetFactions(campaignId),
    adminGetStorylines(campaignId),
    adminGetArtifacts(campaignId),
    adminGetTimelineEvents(campaignId),
  ]);

  const rows = [
    { label: "Moons", count: moons.length, revealed: moons.length, href: "/admin/moons" },
    { label: "Regions", count: regions.length, revealed: regions.filter((r) => r.revealed).length, href: "/admin/regions" },
    { label: "Locations", count: locations.length, revealed: locations.filter((l) => l.revealed).length, href: "/admin/locations" },
    { label: "Characters", count: characters.length, revealed: characters.filter((c) => c.revealed).length, href: "/admin/characters" },
    { label: "Factions", count: factions.length, revealed: factions.filter((f) => f.revealed).length, href: "/admin/factions" },
    { label: "Storylines", count: storylines.length, revealed: storylines.filter((s) => s.revealed).length, href: "/admin/storylines" },
    { label: "Artifacts", count: artifacts.length, revealed: artifacts.filter((a) => a.revealed).length, href: "/admin/artifacts" },
    { label: "Timeline Events", count: events.length, revealed: events.filter((e) => e.revealed).length, href: "/admin/timeline" },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl text-gold mb-2">Welcome back, Dungeon Master</h1>
      <p className="text-parchment/60 mb-8">
        Everything here controls what appears on the player-facing site. Nothing is visible to
        players until you mark it <span className="text-gold">Revealed</span>.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-lg border border-gold/15 bg-void/60 p-5 hover:border-gold/50 transition-colors">
            <div className="text-xs uppercase tracking-widest text-ember/80 mb-1">{r.label}</div>
            <div className="font-display text-2xl text-parchment">{r.count}</div>
            <div className="text-xs text-parchment/40 mt-1">{r.revealed} revealed to players</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
