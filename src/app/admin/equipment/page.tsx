import Link from "next/link";
import { redirect } from "next/navigation";
import { listEquipment, upsertEquipmentItem, copyLibraryEquipmentToCampaign } from "@/lib/library-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field } from "@/components/AdminForm";
import type { EquipmentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const id = await upsertEquipmentItem(campaignId, { name, source: "Homebrew" });
  redirect(`/admin/equipment/${id}`);
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const newId = await copyLibraryEquipmentToCampaign(campaignId, id);
  redirect(newId ? `/admin/equipment/${newId}` : "/admin/equipment");
}

function ItemTable({ rows, library }: { rows: EquipmentItem[]; library: boolean }) {
  return (
    <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Category</th>
            <th className="px-4 py-2">Rarity</th>
            <th className="px-4 py-2">Cost</th>
            <th className="px-4 py-2">Weight</th>
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
              <td className="px-4 py-2 text-parchment">{c.name}</td>
              <td className="px-4 py-2 text-parchment/50">{c.category || "—"}</td>
              <td className="px-4 py-2 text-parchment/50">{c.rarity || "—"}</td>
              <td className="px-4 py-2 text-parchment/50">{c.cost || ""}</td>
              <td className="px-4 py-2 text-parchment/50">{c.weight || ""}</td>
              <td className="px-4 py-2 text-parchment/40 text-xs">{c.source || "—"}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {library ? (
                  <span className="inline-flex items-center gap-3">
                    <Link href={`/admin/equipment/${c.id}`} className="text-gold hover:underline">View</Link>
                    <form action={copyAction.bind(null, c.id)} className="inline">
                      <button type="submit" className="text-gold hover:underline">Copy to Campaign</button>
                    </form>
                  </span>
                ) : (
                  <Link href={`/admin/equipment/${c.id}`} className="text-gold hover:underline">Edit</Link>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-parchment/40">
                {library ? "The platform library is empty." : "No equipment of your own yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminEquipmentPage() {
  const campaignId = await getCurrentCampaignId();
  const all = await listEquipment(campaignId);
  const mine = all.filter((c) => c.campaignId !== null);
  const library = all.filter((c) => c.campaignId === null);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-gold">Equipment</h1>
          <p className="text-sm text-parchment/40 mt-1 max-w-2xl">
            Weapons, armor, gear and magic items - the platform library carries the full SRD, and your own
            homebrew items live beside it. Create one below, or{" "}
            <Link href="/admin/equipment/import" className="text-gold hover:underline">bulk-import a list</Link>.
          </p>
        </div>
        <Link href="/admin/equipment/import" className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm font-medium hover:bg-gold/10 whitespace-nowrap">
          Bulk Import
        </Link>
      </div>

      <form action={createAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-4 max-w-xl">
        <Field label="New Item Name" name="name" required className="flex-1 min-w-[14rem]" />
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold h-fit">
          + Create Item
        </button>
      </form>

      <h2 className="font-display text-lg text-gold mb-3">Your Equipment</h2>
      <ItemTable rows={mine} library={false} />

      <h2 className="font-display text-lg text-gold mt-10 mb-1">Platform Library</h2>
      <p className="text-sm text-parchment/40 mb-3 max-w-2xl">
        The shared armory every DM draws from. Copy an item into your campaign to make it your own and tweak it.
      </p>
      <ItemTable rows={library} library={true} />
    </div>
  );
}
