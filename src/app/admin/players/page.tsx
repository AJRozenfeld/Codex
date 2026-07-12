import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetPlayers, adminBulkDelete } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "players", formData.getAll("ids").map(String));
  redirect("/admin/players");
}

export default async function AdminPlayersPage() {
  const campaignId = await getCurrentCampaignId();
  const players = await adminGetPlayers(campaignId);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Players</h1>
        <Link href="/admin/players/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Player
        </Link>
      </div>
      <p className="text-sm text-parchment/50 mb-4">
        Create one account per player. Link each account to their character so their
        sheet and personalized view are ready as soon as they log in.
      </p>
      <form>
        <BulkActionsBar deleteAction={deleteAction} />
        <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Display Name</th>
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2">Character</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                  <td className="px-4 py-2">
                    <RowCheckbox id={p.id} />
                  </td>
                  <td className="px-4 py-2 text-parchment">{p.displayName}</td>
                  <td className="px-4 py-2 text-parchment/70">{p.username}</td>
                  <td className="px-4 py-2 text-parchment/50">{p.characterName ?? "Not linked"}</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/players/${p.id}`} className="text-gold hover:underline">Edit</Link>
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-parchment/40">No player accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
