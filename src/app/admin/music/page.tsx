import { redirect } from "next/navigation";
import { listMusicTracks, upsertMusicTrack, deleteMusicTrack } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function uploadAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "");
  const tags = String(formData.get("tags") ?? "") || undefined;
  const file = formData.get("file");
  if (!name || !(file instanceof File) || file.size === 0) {
    redirect("/admin/music?error=missing");
  }
  await upsertMusicTrack(campaignId, { name, tags, file });
  redirect("/admin/music");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteMusicTrack(campaignId, id);
  redirect("/admin/music");
}

export default async function AdminMusicPage({ searchParams }: { searchParams: { error?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const tracks = await listMusicTracks(campaignId);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-gold">Music Library</h1>
        <p className="text-sm text-parchment/40 mt-1">
          Upload tracks here so the Discord bot can play them in a voice channel via its{" "}
          <code className="text-gold/80">/panel music</code> menu. Tag tracks (e.g. "combat, tense" or "tavern,
          ambient") to make them easy to find.
        </p>
      </div>

      {searchParams?.error === "missing" && (
        <p className="text-sm text-blood mb-4">Name and an audio file are both required.</p>
      )}

      <form action={uploadAction} className="space-y-4 mb-8 rounded-lg border border-gold/15 p-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name" name="name" required />
          <Field label="Tags (comma-separated)" name="tags" placeholder="combat, tense" />
        </div>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Audio File</span>
          <input
            type="file"
            name="file"
            accept="audio/*"
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          Upload Track
        </button>
      </form>

      <div className="rounded-lg border border-gold/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-void/60 text-parchment/60 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Tags</th>
              <th className="px-4 py-2"></th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => {
              const del = deleteAction.bind(null, t.id);
              return (
                <tr key={t.id} className="border-t border-gold/10">
                  <td className="px-4 py-2 text-parchment">{t.name}</td>
                  <td className="px-4 py-2 text-parchment/50">{t.tags ?? ""}</td>
                  <td className="px-4 py-2">
                    <audio controls src={t.fileUrl} className="h-8" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <form action={del}>
                      <button type="submit" className="text-sm text-blood hover:underline">Delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {tracks.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-parchment/40">No tracks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
