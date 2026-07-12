import Link from "next/link";
import { redirect } from "next/navigation";
import { listScenes, createScene } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const id = await createScene(campaignId, name);
  redirect(`/admin/scenes/${id}`);
}

export default async function AdminScenesPage() {
  const campaignId = await getCurrentCampaignId();
  const scenes = await listScenes(campaignId);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-gold">Scenes</h1>
        <p className="text-sm text-parchment/40 mt-1">
          A hotkey for battle setup: pick creatures (from your{" "}
          <Link href="/admin/creatures" className="text-gold hover:underline">Creature Library</Link>{" "}
          and/or one-off ad-hoc stat blocks), optionally existing NPCs, and a track or{" "}
          <Link href="/admin/playlists" className="text-gold hover:underline">Playlist</Link>{" "}
          to play. Activating a scene from Discord's <code className="text-gold/80">/panel scenes</code> starts a
          battle, auto-rolls initiative for everyone listed, and starts the music - all in one go.
        </p>
      </div>

      <form action={createAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-4">
        <label className="block flex-1 min-w-[14rem]">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">New Scene Name</span>
          <input
            name="name"
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold h-fit">
          + Create Scene
        </button>
      </form>

      <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Music</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((s) => (
              <tr key={s.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                <td className="px-4 py-2 text-parchment">{s.name}</td>
                <td className="px-4 py-2 text-parchment/50">
                  {s.trackId ? "1 track" : s.playlistId ? `playlist${s.shuffle ? " (shuffle)" : ""}` : "none"}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/scenes/${s.id}`} className="text-gold hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
            {scenes.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-parchment/40">No scenes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
