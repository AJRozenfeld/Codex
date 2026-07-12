import { notFound, redirect } from "next/navigation";
import {
  getSceneDetail,
  updateSceneSettings,
  deleteScene,
  listCreatures,
  addLibraryCreatureToScene,
  addAdHocCreatureToScene,
  removeSceneCreature,
  addCharacterToScene,
  removeSceneCharacter,
  listMusicTracks,
  listPlaylists,
} from "@/lib/discord-io";
import { adminGetCharacters } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Select, Checkbox, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function updateSettingsAction(sceneId: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await updateSceneSettings(campaignId, sceneId, {
    name,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    trackId: String(formData.get("trackId") ?? "") || null,
    playlistId: String(formData.get("playlistId") ?? "") || null,
    shuffle: formData.get("shuffle") === "on",
  });
  redirect(`/admin/scenes/${sceneId}`);
}

async function deleteSceneAction(sceneId: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteScene(campaignId, sceneId);
  redirect("/admin/scenes");
}

async function addLibraryCreatureAction(sceneId: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const creatureId = String(formData.get("creatureId") ?? "");
  if (!creatureId) return;
  const quantity = Number(formData.get("quantity") ?? 1) || 1;
  await addLibraryCreatureToScene(campaignId, sceneId, creatureId, quantity);
  redirect(`/admin/scenes/${sceneId}`);
}

async function addAdHocCreatureAction(sceneId: string, formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const hpRaw = String(formData.get("hp") ?? "").trim();
  const acRaw = String(formData.get("ac") ?? "").trim();
  const initBonusRaw = String(formData.get("initBonus") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 1) || 1;
  await addAdHocCreatureToScene(sceneId, {
    name,
    hp: hpRaw ? Number(hpRaw) : null,
    ac: acRaw ? Number(acRaw) : null,
    initBonus: initBonusRaw ? Number(initBonusRaw) : 0,
    quantity,
  });
  redirect(`/admin/scenes/${sceneId}`);
}

async function removeCreatureAction(sceneId: string, sceneCreatureId: string) {
  "use server";
  await removeSceneCreature(sceneCreatureId);
  redirect(`/admin/scenes/${sceneId}`);
}

async function addCharacterAction(sceneId: string, formData: FormData) {
  "use server";
  const characterId = String(formData.get("characterId") ?? "");
  if (!characterId) return;
  await addCharacterToScene(sceneId, characterId);
  redirect(`/admin/scenes/${sceneId}`);
}

async function removeCharacterAction(sceneId: string, sceneCharacterId: string) {
  "use server";
  await removeSceneCharacter(sceneCharacterId);
  redirect(`/admin/scenes/${sceneId}`);
}

export default async function AdminSceneEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const [scene, library, tracks, playlists, allCharacters] = await Promise.all([
    getSceneDetail(campaignId, params.id),
    listCreatures(campaignId),
    listMusicTracks(campaignId),
    listPlaylists(campaignId),
    adminGetCharacters(campaignId),
  ]);
  if (!scene) notFound();

  const addedCharacterIds = new Set(scene.characters.map((c) => c.characterId));
  const availableCharacters = allCharacters.filter((c) => !addedCharacterIds.has(c.id));

  const updateSettings = updateSettingsAction.bind(null, params.id);
  const del = deleteSceneAction.bind(null, params.id);
  const addLibraryCreature = addLibraryCreatureAction.bind(null, params.id);
  const addAdHocCreature = addAdHocCreatureAction.bind(null, params.id);
  const addCharacter = addCharacterAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">Edit Scene: {scene.name}</h1>

      <form action={updateSettings} className="space-y-4">
        <Field label="Scene Name" name="name" defaultValue={scene.name} required />
        <TextArea label="Notes (DM-only, e.g. read-aloud text or setup reminders)" name="notes" defaultValue={scene.notes} rows={3} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Select
            label="Play This Track"
            name="trackId"
            defaultValue={scene.trackId ?? ""}
            options={tracks.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            label="Or This Playlist"
            name="playlistId"
            defaultValue={scene.playlistId ?? ""}
            options={playlists.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
        <p className="text-xs text-parchment/45 -mt-2">
          Choose a track OR a playlist, not both - if both are set, the playlist wins. Leave both blank for no music.
        </p>
        <Checkbox label="Shuffle the playlist (only applies if a playlist is chosen)" name="shuffle" defaultChecked={scene.shuffle} />
        <FormActions deleteAction={del} />
      </form>

      <div className="mt-10 space-y-4">
        <h2 className="font-display text-xl text-gold">Creatures</h2>
        <ul className="space-y-1.5">
          {scene.creatures.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded bg-void/40 px-3 py-1.5">
              <span className="text-sm text-parchment">
                {c.name}
                {c.quantity > 1 && <span className="text-parchment/50"> &times;{c.quantity}</span>}
                <span className="text-parchment/40 text-xs ml-2">
                  {c.hp !== null && `HP ${c.hp}`}
                  {c.hp !== null && c.ac !== null && " · "}
                  {c.ac !== null && `AC ${c.ac}`}
                  {(c.hp !== null || c.ac !== null) && " · "}
                  Init {c.initBonus >= 0 ? `+${c.initBonus}` : c.initBonus}
                </span>
              </span>
              <form action={removeCreatureAction.bind(null, params.id, c.id)}>
                <button type="submit" className="text-xs text-blood/80 hover:underline">Remove</button>
              </form>
            </li>
          ))}
          {scene.creatures.length === 0 && (
            <li className="text-xs text-parchment/40 px-3 py-1">No creatures in this scene yet.</li>
          )}
        </ul>

        <form action={addLibraryCreature} className="flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-3">
          <label className="block flex-1 min-w-[12rem]">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">From Library</span>
            <select
              name="creatureId"
              defaultValue=""
              className="w-full rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
            >
              <option value="" disabled>&mdash; choose a creature &mdash;</option>
              {library.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block w-24">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Qty</span>
            <input
              type="number"
              name="quantity"
              min={1}
              defaultValue={1}
              className="w-full rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
            />
          </label>
          <button
            type="submit"
            disabled={library.length === 0}
            className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10 disabled:opacity-30 whitespace-nowrap"
          >
            + Add
          </button>
        </form>
        {library.length === 0 && (
          <p className="text-xs text-parchment/40">
            No creatures in your library yet - add some from the{" "}
            <a href="/admin/creatures" className="text-gold hover:underline">Creature Library</a>, or add one below ad-hoc.
          </p>
        )}

        <form action={addAdHocCreature} className="space-y-3 rounded-lg border border-gold/15 p-3">
          <span className="block text-xs uppercase tracking-widest text-ember/80">Add Ad-Hoc (one-off, not saved to the library)</span>
          <div className="flex flex-wrap gap-3">
            <Field label="Name" name="name" className="flex-1 min-w-[10rem]" />
            <Field label="HP" name="hp" type="number" className="w-20" />
            <Field label="AC" name="ac" type="number" className="w-20" />
            <Field label="Init Bonus" name="initBonus" type="number" defaultValue="0" className="w-24" />
            <Field label="Qty" name="quantity" type="number" defaultValue="1" className="w-20" />
          </div>
          <button type="submit" className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10">
            + Add Ad-Hoc
          </button>
        </form>
      </div>

      <div className="mt-10 space-y-4">
        <h2 className="font-display text-xl text-gold">Existing NPCs / Characters</h2>
        <ul className="space-y-1.5">
          {scene.characters.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded bg-void/40 px-3 py-1.5">
              <span className="text-sm text-parchment">{c.name}</span>
              <form action={removeCharacterAction.bind(null, params.id, c.id)}>
                <button type="submit" className="text-xs text-blood/80 hover:underline">Remove</button>
              </form>
            </li>
          ))}
          {scene.characters.length === 0 && (
            <li className="text-xs text-parchment/40 px-3 py-1">No existing characters in this scene yet.</li>
          )}
        </ul>

        <form action={addCharacter} className="flex flex-wrap items-center gap-3">
          <select
            name="characterId"
            defaultValue=""
            className="flex-1 min-w-[14rem] rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
          >
            <option value="" disabled>&mdash; choose a character &mdash;</option>
            {availableCharacters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.isPc ? " (PC)" : ""}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={availableCharacters.length === 0}
            className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10 disabled:opacity-30 whitespace-nowrap"
          >
            + Add Character
          </button>
        </form>
        <p className="text-xs text-parchment/45">
          Added characters roll their own initiative the normal way (<code className="text-gold/70">[[mask]]: *init*</code>)
          once the scene starts - they aren't auto-rolled like creatures above.
        </p>
      </div>
    </div>
  );
}
