import { notFound, redirect } from "next/navigation";
import {
  adminGetMap,
  adminUpsertMap,
  adminDeleteMap,
  adminGetMaps,
  adminGetLocations,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
  adminGetMapPins,
  adminCreateMapPin,
  adminUpdateMapPin,
  adminDeleteMapPin,
  adminGetMapRegions,
  adminCreateMapRegion,
  adminUpdateMapRegion,
  adminDeleteMapRegion,
  adminGetCharacterMapTokens,
  adminSetCharacterMapPosition,
  adminClearCharacterMapPosition,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, Select, Checkbox, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";
import { MapPinEditor } from "@/components/MapPinEditor";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const imageFile = formData.get("image");
  await adminUpsertMap(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      locationId: String(formData.get("locationId") ?? "") || null,
      isRoot: formData.get("isRoot") === "on",
      revealed: formData.get("revealed") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0),
      imageFile: imageFile instanceof File ? imageFile : null,
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect("/admin/maps");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteMap(campaignId, id);
  redirect("/admin/maps");
}

async function createPinAction(
  mapId: string,
  x: number,
  y: number,
  label: string,
  targetMapId: string | null
): Promise<string> {
  "use server";
  return adminCreateMapPin(mapId, { x, y, label: label || null, targetMapId });
}

async function updatePinAction(
  pinId: string,
  x: number,
  y: number,
  label: string,
  targetMapId: string | null
): Promise<void> {
  "use server";
  await adminUpdateMapPin(pinId, { x, y, label: label || null, targetMapId });
}

async function deletePinAction(pinId: string): Promise<void> {
  "use server";
  await adminDeleteMapPin(pinId);
}

async function createRegionAction(
  mapId: string,
  locationId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<string> {
  "use server";
  return adminCreateMapRegion(mapId, { locationId, x, y, width, height });
}

async function updateRegionAction(
  regionId: string,
  locationId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  "use server";
  await adminUpdateMapRegion(regionId, { locationId, x, y, width, height });
}

async function deleteRegionAction(regionId: string): Promise<void> {
  "use server";
  await adminDeleteMapRegion(regionId);
}

async function setTokenPositionAction(mapId: string, characterId: string, x: number, y: number): Promise<void> {
  "use server";
  await adminSetCharacterMapPosition(mapId, characterId, x, y);
}

async function clearTokenPositionAction(
  campaignId: string,
  mapId: string,
  characterId: string
): Promise<{ x: number; y: number } | null> {
  "use server";
  await adminClearCharacterMapPosition(mapId, characterId);
  const tokens = await adminGetCharacterMapTokens(campaignId, mapId);
  const token = tokens.find((t) => t.characterId === characterId);
  if (!token || token.x === null || token.y === null) return null;
  return { x: token.x, y: token.y };
}

export default async function AdminMapEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [map, allMaps, locations, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetMap(campaignId, params.id),
    adminGetMaps(campaignId),
    adminGetLocations(campaignId),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("maps", params.id),
  ]);
  if (!isNew && !map) notFound();

  const pins = isNew ? [] : await adminGetMapPins(params.id);
  const regions = isNew ? [] : await adminGetMapRegions(params.id);
  const tokens = isNew ? [] : await adminGetCharacterMapTokens(campaignId, params.id);
  const otherMaps = allMaps.filter((m) => m.id !== params.id).map((m) => ({ id: m.id, name: m.name }));

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);
  const boundCreatePin = createPinAction.bind(null, params.id);
  const boundUpdatePin = updatePinAction.bind(null);
  const boundDeletePin = deletePinAction.bind(null);
  const boundCreateRegion = createRegionAction.bind(null, params.id);
  const boundUpdateRegion = updateRegionAction.bind(null);
  const boundDeleteRegion = deleteRegionAction.bind(null);
  const boundSetTokenPosition = setTokenPositionAction.bind(null, params.id);
  const boundClearTokenPosition = clearTokenPositionAction.bind(null, campaignId, params.id);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Map" : `Edit: ${map!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={map?.name} required />
        <Select
          label="Linked Location (optional)"
          name="locationId"
          defaultValue={map?.locationId ?? ""}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">
            Map Image {map ? "(leave blank to keep current image)" : ""}
          </span>
          <input
            type="file"
            name="image"
            accept="image/*"
            required={isNew}
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        </label>
        {map?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={map.imageUrl} alt={map.name} className="max-h-48 rounded-lg border border-gold/15" />
        )}
        <div className="flex gap-6">
          <Checkbox label="Root Map (default starting map for players)" name="isRoot" defaultChecked={map?.isRoot} />
        </div>
        <Field label="Sort order" name="sortOrder" type="number" defaultValue={String(map?.sortOrder ?? 0)} />
        <RevealedToggle defaultChecked={map ? map.revealed : true} />
        <CheckboxGroup
          label="Restrict to specific players (leave empty = visible to every player)"
          name="restrictedPlayerIds"
          options={players.map((p) => ({ value: p.id, label: p.displayName }))}
          selected={selectedRestrictedIds}
        />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>

      {!isNew && map && (
        <div className="mt-10">
          <h2 className="font-display text-xl text-gold mb-4">Pins, Regions &amp; Tokens</h2>
          <MapPinEditor
            mapId={map.id}
            imageUrl={map.imageUrl}
            initialPins={pins}
            otherMaps={otherMaps}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            initialRegions={regions}
            initialTokens={tokens}
            createPinAction={boundCreatePin}
            updatePinAction={boundUpdatePin}
            deletePinAction={boundDeletePin}
            createRegionAction={boundCreateRegion}
            updateRegionAction={boundUpdateRegion}
            deleteRegionAction={boundDeleteRegion}
            setTokenPositionAction={boundSetTokenPosition}
            clearTokenPositionAction={boundClearTokenPosition}
          />
        </div>
      )}
    </div>
  );
}
