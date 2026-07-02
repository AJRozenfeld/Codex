import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetMaps, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "maps", formData.getAll("ids").map(String));
  redirect("/admin/maps");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "maps", formData.getAll("ids").map(String));
  redirect("/admin/maps");
}

export default async function AdminMapsPage() {
  const campaignId = await getCurrentCampaignId();
  const maps = await adminGetMaps(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Maps</h1>
        <Link href="/admin/maps/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Map
        </Link>
      </div>
      <form>
        <BulkActionsBar toggleAction={toggleAction} deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-void/60 text-parchment/60 text-left">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Linked Location</th>
                <th className="px-4 py-2">Root Map</th>
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id} className="border-t border-gold/10">
                  <td className="px-4 py-2">
                    <RowCheckbox id={m.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{m.name}</td>
                  <td className="px-4 py-2 text-parchment/50">{m.locationName ?? "-"}</td>
                  <td className="px-4 py-2 text-parchment/50">{m.isRoot ? "Yes" : ""}</td>
                  <td className="px-4 py-2">
                    {m.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/maps/${m.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {maps.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-parchment/40">No maps yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
