import { notFound, redirect } from "next/navigation";
import {
  getPlaylistDetail,
  renamePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  movePlaylistTrack,
  listMusicTracks,
} from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function renameAction(playlistId: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await renamePlaylist(campaignId, playlistId, name);
  redirect(`/admin/playlists/${playlistId}`);
}

async function deleteAction(playlistId: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deletePlaylist(campaignId, playlistId);
  redirect("/admin/playlists");
}

async function addTrackAction(playlistId: string, formData: FormData) {
  "use server";
  const trackId = String(formData.get("trackId") ?? "");
  if (!trackId) return;
  await addTrackToPlaylist(playlistId, trackId);
  redirect(`/admin/playlists/${playlistId}`);
}

async function removeTrackAction(playlistId: string, playlistTrackId: string) {
  "use server";
  await removeTrackFromPlaylist(playlistTrackId);
  redirect(`/admin/playlists/${playlistId}`);
}

async function moveTrackAction(playlistId: string, playlistTrackId: string, direction: "up" | "down") {
  "use server";
  await movePlaylistTrack(playlistId, playlistTrackId, direction);
  redirect(`/admin/playlists/${playlistId}`);
}

export default async function AdminPlaylistEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const [playlist, allTracks] = await Promise.all([
    getPlaylistDetail(campaignId, params.id),
    listMusicTracks(campaignId),
  ]);
  if (!playlist) notFound();

  const addedTrackIds = new Set(playlist.tracks.map((t) => t.trackId));
  const availableTracks = allTracks.filter((t) => !addedTrackIds.has(t.id));

  const rename = renameAction.bind(null, params.id);
  const del = deleteAction.bind(null, params.id);
  const addTrack = addTrackAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">Edit Playlist: {playlist.name}</h1>

      <form action={rename} className="space-y-4">
        <Field label="Playlist Name" name="name" defaultValue={playlist.name} required />
        <FormActions deleteAction={del} />
      </form>

      <div className="mt-10 space-y-4">
        <h2 className="font-display text-xl text-gold">Tracks (play order)</h2>
        <ul className="space-y-1.5">
          {playlist.tracks.map((t, index) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded bg-void/40 px-3 py-1.5">
              <span className="text-sm text-parchment">
                <span className="text-parchment/40 mr-2">{index + 1}.</span>
                {t.name}
                {t.tags && <span className="text-parchment/40 text-xs ml-2">({t.tags})</span>}
              </span>
              <div className="flex items-center gap-3">
                <form action={moveTrackAction.bind(null, params.id, t.id, "up")}>
                  <button
                    type="submit"
                    disabled={index === 0}
                    className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20"
                  >
                    &uarr;
                  </button>
                </form>
                <form action={moveTrackAction.bind(null, params.id, t.id, "down")}>
                  <button
                    type="submit"
                    disabled={index === playlist.tracks.length - 1}
                    className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20"
                  >
                    &darr;
                  </button>
                </form>
                <form action={removeTrackAction.bind(null, params.id, t.id)}>
                  <button type="submit" className="text-xs text-blood/80 hover:underline">Remove</button>
                </form>
              </div>
            </li>
          ))}
          {playlist.tracks.length === 0 && (
            <li className="text-xs text-parchment/40 px-3 py-1">No tracks in this playlist yet.</li>
          )}
        </ul>

        <form action={addTrack} className="flex flex-wrap items-center gap-3">
          <select
            name="trackId"
            defaultValue=""
            className="flex-1 min-w-[14rem] rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
          >
            <option value="" disabled>&mdash; choose a track &mdash;</option>
            {availableTracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={availableTracks.length === 0}
            className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10 disabled:opacity-30 whitespace-nowrap"
          >
            + Add Track
          </button>
        </form>
        {availableTracks.length === 0 && allTracks.length > 0 && (
          <p className="text-xs text-parchment/40">Every uploaded track is already in this playlist.</p>
        )}
        {allTracks.length === 0 && (
          <p className="text-xs text-parchment/40">
            No tracks uploaded yet - add some from the Music Library first.
          </p>
        )}
      </div>
    </div>
  );
}
