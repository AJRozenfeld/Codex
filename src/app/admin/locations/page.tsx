import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetLocations, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "locations", formData.getAll("ids").map(String));
  redirect("/admin/locations");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "locations", formData.getAll("ids").map(String));
  redirect("/admin/locations");
}

export default async function AdminLocationsPage() {
  const campaignId = await getCurrentCampaignId();
  const locations = await adminGetLocations(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Locations</h1>
        <Link href="/admin/locations/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Location
        </Link>
      </div>
      <form>
        <BulkActionsBar toggleAction={toggleAction} deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Parent / Region</th>
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                  <td className="px-4 py-2">
                    <RowCheckbox id={l.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{l.name}</td>
                  <td className="px-4 py-2 text-parchment/70">{l.type}</td>
                  <td className="px-4 py-2 text-parchment/50">{l.parentName ?? l.regionName ?? "-"}</td>
                  <td className="px-4 py-2">
                    {l.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/locations/${l.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-parchment/40">No locations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
