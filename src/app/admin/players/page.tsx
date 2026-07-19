import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminGetPlayers,
  adminBulkDelete,
  adminGetUnassignedPlayers,
  adminAssignPlayerToCampaign,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getCurrentDmId, getDmAccount } from "@/lib/dm-queries";
import { BulkActionsBar, RowCheckbox } from "@/components/AdminForm";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

async function deleteAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminBulkDelete(campaignId, "players", formData.getAll("ids").map(String));
  redirect("/admin/players");
}

async function assignAction(playerId: string) {
  "use server";
  const [dmId, campaignId] = await Promise.all([getCurrentDmId(), getCurrentCampaignId()]);
  try {
    await adminAssignPlayerToCampaign(dmId, playerId, campaignId);
  } catch (err) {
    redirect(`/admin/players?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect("/admin/players");
}

export default async function AdminPlayersPage({ searchParams }: { searchParams: { error?: string } }) {
  const [campaignId, dmId] = await Promise.all([getCurrentCampaignId(), getCurrentDmId()]);
  const [players, unassigned, dm] = await Promise.all([
    adminGetPlayers(campaignId),
    adminGetUnassignedPlayers(dmId),
    getDmAccount(dmId),
  ]);

  // The shareable self-registration link for this DM's players. Pinned to
  // SITE_URL when configured so browsing the panel via a protected Vercel
  // deployment URL can never leak that host into a player's invite (see
  // src/lib/site-url.ts for the incident this prevents).
  const origin = siteOrigin(headers().get("host"));
  const joinUrl = dm ? `${origin}/join/${dm.slug}` : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Players</h1>
        <Link href="/admin/players/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Player
        </Link>
      </div>

      {joinUrl && (
        <div className="mb-6 rounded-lg border border-gold/20 bg-void p-4">
          <p className="text-xs uppercase tracking-widest text-ember/80 mb-1">Your player join link</p>
          <code className="block text-gold break-all select-all">{joinUrl}</code>
          <p className="text-xs text-parchment/40 mt-2">
            Share this with your players - they create their own account there, then you assign them to a
            campaign below. They log in at <code className="text-gold/70">{`${origin}/login/${dm!.slug}`}</code>.
          </p>
        </div>
      )}

      {searchParams?.error && <p className="text-sm text-blood mb-4">{searchParams.error}</p>}

      {unassigned.length > 0 && (
        <div className="mb-6 rounded-lg border border-ember/30 bg-void p-4">
          <p className="text-xs uppercase tracking-widest text-ember/80 mb-3">
            Awaiting assignment ({unassigned.length})
          </p>
          <ul className="space-y-2">
            {unassigned.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-parchment">
                  {p.displayName} <span className="text-parchment/50">({p.username})</span>
                </span>
                <form action={assignAction.bind(null, p.id)}>
                  <button
                    type="submit"
                    className="rounded-full border border-gold/40 text-gold px-3 py-1 text-xs hover:bg-gold/10 hover:border-gold/70 transition-colors"
                  >
                    Add to this campaign
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="text-xs text-parchment/40 mt-3">
            These players registered through your join link. Switch campaigns (top bar) to add them elsewhere.
          </p>
        </div>
      )}

      <p className="text-sm text-parchment/50 mb-4">
        Accounts in this campaign. Link each account to their character so their sheet and personalized view
        are ready as soon as they log in.
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
