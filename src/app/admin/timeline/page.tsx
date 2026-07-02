import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetTimelineEvents, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "timeline_events", formData.getAll("ids").map(String));
  redirect("/admin/timeline");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "timeline_events", formData.getAll("ids").map(String));
  redirect("/admin/timeline");
}

export default async function AdminTimelinePage() {
  const campaignId = await getCurrentCampaignId();
  const events = await adminGetTimelineEvents(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Timeline Events</h1>
        <Link href="/admin/timeline/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Event
        </Link>
      </div>
      <form>
        <BulkActionsBar toggleAction={toggleAction} deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-void/60 text-parchment/60 text-left">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-gold/10">
                  <td className="px-4 py-2">
                    <RowCheckbox id={e.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment/40">{e.sortIndex}</td>
                  <td className="px-4 py-2 text-parchment">{e.title}</td>
                  <td className="px-4 py-2 text-parchment/50">{e.inWorldDate ?? "-"}</td>
                  <td className="px-4 py-2">
                    {e.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/timeline/${e.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-parchment/40">No events yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
