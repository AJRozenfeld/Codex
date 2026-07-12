import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetCharacters, adminBulkToggleRevealed, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function toggleAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkToggleRevealed(campaignId, "characters", formData.getAll("ids").map(String));
  redirect("/admin/characters");
}

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "characters", formData.getAll("ids").map(String));
  redirect("/admin/characters");
}

export default async function AdminCharactersPage() {
  const campaignId = await getCurrentCampaignId();
  const characters = await adminGetCharacters(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Characters</h1>
        <Link href="/admin/characters/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Character
        </Link>
      </div>
      <form>
        <BulkActionsBar toggleAction={toggleAction} deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2 w-12"></th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">PC / NPC</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Revealed</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {characters.map((c) => (
                <tr key={c.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                  <td className="px-4 py-2">
                    <RowCheckbox id={c.id} />
                  </td>
                  <td className="px-4 py-2">
                    {c.portraitPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.portraitPath} alt={c.name} className="h-8 w-8 rounded-full object-cover border border-gold/20" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-void border border-gold/10" />
                    )}
                  </td>
                  <td className="px-4 py-2 text-parchment">{c.name}</td>
                  <td className="px-4 py-2 text-parchment/70">{c.isPc ? "PC" : "NPC"}</td>
                  <td className="px-4 py-2 text-parchment/50">{c.isAlive ? c.status ?? "Alive" : "Deceased"}</td>
                  <td className="px-4 py-2">
                    {c.revealed ? (
                      <span className="text-gold text-xs">&#9679; Revealed</span>
                    ) : (
                      <span className="text-parchment/30 text-xs">&#9675; Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/characters/${c.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {characters.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-parchment/40">No characters yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
