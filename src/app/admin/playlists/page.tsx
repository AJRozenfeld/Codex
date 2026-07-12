import Link from "next/link";
import { redirect } from "next/navigation";
import { listPlaylists, createPlaylist } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const id = await createPlaylist(campaignId, name);
  redirect(`/admin/playlists/${id}`);
}

export default async function AdminPlaylistsPage() {
  const campaignId = await getCurrentCampaignId();
  const playlists = await listPlaylists(campaignId);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-gold">Playlists</h1>
        <p className="text-sm text-parchment/40 mt-1">
          Group existing tracks from the <Link href="/admin/music" className="text-gold hover:underline">Music Library</Link>{" "}
          into an ordered playlist. From Discord, <code className="text-gold/80">/panel music</code> can play a
          playlist straight through in order, or shuffled.
        </p>
      </div>

      <form action={createAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-4">
        <label className="block flex-1 min-w-[14rem]">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">New Playlist Name</span>
          <input
            name="name"
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold h-fit">
          + Create Playlist
        </button>
      </form>

      <div className="rounded-lg border border-gold/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-void/60 text-parchment/60 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Tracks</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {playlists.map((p) => (
              <tr key={p.id} className="border-t border-gold/10">
                <td className="px-4 py-2 text-parchment">{p.name}</td>
                <td className="px-4 py-2 text-parchment/50">{p.trackCount}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/playlists/${p.id}`} className="text-gold hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
            {playlists.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-parchment/40">No playlists yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
