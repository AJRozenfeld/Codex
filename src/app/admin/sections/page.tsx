import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetSections, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "sections", formData.getAll("ids").map(String));
  redirect("/admin/sections");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "sections", formData.getAll("ids").map(String));
  redirect("/admin/sections");
}

export default async function AdminSectionsPage() {
  const campaignId = await getCurrentCampaignId();
  const sections = await adminGetSections(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-gold">Sections</h1>
          <p className="text-sm text-parchment/50 mt-1">
            Custom player-facing pages built from lists of existing characters, locations, factions, storylines,
            artifacts, and regions.
          </p>
        </div>
        <Link href="/admin/sections/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Section
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
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.id} className="border-t border-gold/10">
                  <td className="px-4 py-2">
                    <RowCheckbox id={s.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{s.name}</td>
                  <td className="px-4 py-2">
                    {s.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/sections/${s.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {sections.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-parchment/40">No sections yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
