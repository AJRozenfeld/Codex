import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listMusicTracks, upsertMusicTrack, deleteMusicTrack } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { MusicUploadForm } from "@/components/MusicUploadForm";

export const dynamic = "force-dynamic";

// Called by the client-side MusicUploadForm AFTER the audio file itself has
// already gone straight from the browser to Vercel Blob (see
// /api/blob/music-upload/route.ts) - only the resulting URL passes through
// here, never the raw file, so this never touches the Server Actions body
// size limit that made uploads of real audio files silently fail before.
async function saveTrackAction(input: { name: string; tags?: string; scene?: string; fileUrl: string }) {
  "use server";
  if (!input.name || !input.fileUrl) {
    throw new Error("Name and an audio file are both required.");
  }
  const campaignId = await getCurrentCampaignId();
  await upsertMusicTrack(campaignId, { name: input.name, tags: input.tags, scene: input.scene, fileUrl: input.fileUrl });
  revalidatePath("/admin/music");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteMusicTrack(campaignId, id);
  redirect("/admin/music");
}

export default async function AdminMusicPage() {
  const campaignId = await getCurrentCampaignId();
  const tracks = await listMusicTracks(campaignId);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-gold">Music Library</h1>
          <p className="text-sm text-parchment/40 mt-1">
            Upload tracks here so the Discord bot can play them in a voice channel via its{" "}
            <code className="text-gold/80">/panel music</code> menu. Tag tracks (e.g. "combat, tense" or "tavern,
            ambient") to make them easy to find. Group tracks into a <Link href="/admin/playlists" className="text-gold hover:underline">Playlist</Link>{" "}
            to let the bot play several in a row, in order or shuffled.
          </p>
        </div>
        <Link
          href="/admin/playlists"
          className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm font-medium hover:bg-gold/10 whitespace-nowrap"
        >
          Manage Playlists
        </Link>
      </div>

      <MusicUploadForm saveTrackAction={saveTrackAction} />

      <div className="rounded-lg border border-gold/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-void/60 text-parchment/60 text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Tags</th>
              <th className="px-4 py-2">Scene</th>
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
                  <td className="px-4 py-2 text-parchment/50">{t.scene ?? ""}</td>
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
              <tr><td colSpan={5} className="px-4 py-6 text-center text-parchment/40">No tracks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
