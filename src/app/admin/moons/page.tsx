import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetMoons, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "moons", formData.getAll("ids").map(String));
  redirect("/admin/moons");
}

export default async function AdminMoonsPage() {
  const campaignId = await getCurrentCampaignId();
  const moons = await adminGetMoons(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Moons</h1>
        <Link href="/admin/moons/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Moon
        </Link>
      </div>
      <form>
        <BulkActionsBar deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-void/60 text-parchment/60 text-left">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Domain</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {moons.map((m) => (
                <tr key={m.id} className="border-t border-gold/10">
                  <td className="px-4 py-2">
                    <RowCheckbox id={m.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{m.name}</td>
                  <td className="px-4 py-2 text-parchment/70">{m.domain}</td>
                  <td className="px-4 py-2 text-parchment/50">{m.isGoddess ? "Goddess" : "Moon"}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/moons/${m.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {moons.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-parchment/40">No moons yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
