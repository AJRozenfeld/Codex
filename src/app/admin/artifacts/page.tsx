import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetArtifacts, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "artifacts", formData.getAll("ids").map(String));
  redirect("/admin/artifacts");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "artifacts", formData.getAll("ids").map(String));
  redirect("/admin/artifacts");
}

export default async function AdminArtifactsPage() {
  const campaignId = await getCurrentCampaignId();
  const artifacts = await adminGetArtifacts(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Artifacts</h1>
        <Link href="/admin/artifacts/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Artifact
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
                <th className="px-4 py-2">Holder</th>
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                  <td className="px-4 py-2">
                    <RowCheckbox id={a.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{a.name}</td>
                  <td className="px-4 py-2 text-parchment/70">{a.type}</td>
                  <td className="px-4 py-2 text-parchment/50">{a.ownerName ?? a.locationName ?? "-"}</td>
                  <td className="px-4 py-2">
                    {a.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/artifacts/${a.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {artifacts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-parchment/40">No artifacts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
