import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { adminGetCampaigns, getCurrentCampaignId, setCurrentCampaignId } from "@/lib/campaign-queries";
import { CampaignSwitcher } from "@/components/CampaignSwitcher";

const sections = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/board", label: "DM Screen" },
  { href: "/admin/moons", label: "Moons" },
  { href: "/admin/regions", label: "Regions" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/characters", label: "Characters" },
  { href: "/admin/factions", label: "Factions" },
  { href: "/admin/storylines", label: "Storylines" },
  { href: "/admin/artifacts", label: "Artifacts" },
  { href: "/admin/timeline", label: "Timeline" },
  { href: "/admin/maps", label: "Maps" },
  { href: "/admin/sections", label: "Sections" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/players", label: "Players" },
];

async function logoutAction() {
  "use server";
  const session = await getAdminSession();
  session.destroy();
  redirect("/admin/login");
}

async function switchCampaignAction(campaignId: string) {
  "use server";
  await setCurrentCampaignId(campaignId);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [campaigns, currentCampaignId] = await Promise.all([adminGetCampaigns(), getCurrentCampaignId()]);

  return (
    <div className="min-h-screen bg-ink text-parchment">
      <div className="border-b border-gold/20 bg-void/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-6 flex-wrap">
            <span className="font-display text-gold">DM Console</span>
            <nav className="flex flex-wrap gap-4 text-sm text-parchment/70">
              {sections.map((s) => (
                <Link key={s.href} href={s.href} className="hover:text-gold transition-colors">
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <CampaignSwitcher
              campaigns={campaigns}
              currentCampaignId={currentCampaignId}
              switchAction={switchCampaignAction}
            />
            <Link href="/admin/campaigns" className="text-xs text-parchment/50 hover:text-gold">Manage</Link>
            <Link
              href="/admin/campaigns/new"
              className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
            >
              + New Campaign
            </Link>
            <Link href="/" className="text-xs text-parchment/40 hover:text-gold">View public site</Link>
            <form action={logoutAction}>
              <button type="submit" className="text-xs text-parchment/50 hover:text-blood">Log out</button>
            </form>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}
