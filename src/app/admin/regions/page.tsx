import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetRegions, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "regions", formData.getAll("ids").map(String));
  redirect("/admin/regions");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "regions", formData.getAll("ids").map(String));
  redirect("/admin/regions");
}

export default async function AdminRegionsPage() {
  const campaignId = await getCurrentCampaignId();
  const regions = await adminGetRegions(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Regions</h1>
        <Link href="/admin/regions/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Region
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
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                  <td className="px-4 py-2">
                    <RowCheckbox id={r.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{r.name}</td>
                  <td className="px-4 py-2 text-parchment/70">{r.type}</td>
                  <td className="px-4 py-2">
                    {r.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/regions/${r.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {regions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-parchment/40">No regions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
