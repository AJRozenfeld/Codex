"use client";

import { useEffect, useRef, useState } from "react";
import type { MapPin, MapRegion, AdminCharacterMapToken } from "@/lib/types";

const ICON_OPTIONS = [
  { value: "", label: "Default" },
  { value: "city", label: "City" },
  { value: "ruin", label: "Ruin" },
  { value: "landmark", label: "Landmark" },
  { value: "dungeon", label: "Dungeon" },
  { value: "district", label: "District" },
];

const ICON_GLYPHS: Record<string, string> = {
  city: "●",
  ruin: "†",
  landmark: "★",
  dungeon: "▲",
  district: "■",
};

interface DraftPin {
  pinId: string | null; // null = creating a new pin
  x: number;
  y: number;
  label: string;
  icon: string;
  targetMapId: string;
}

interface DraftRegion {
  regionId: string | null; // null = creating a new region
  x: number;
  y: number;
  width: number;
  height: number;
  locationId: string;
}

interface DrawingRect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

const MIN_REGION_SIZE = 0.02; // fraction of image - smaller than this is treated as an accidental click, not a drag

export function MapPinEditor({
  mapId,
  imageUrl,
  initialPins,
  otherMaps,
  locations,
  initialRegions,
  initialTokens,
  createPinAction,
  updatePinAction,
  deletePinAction,
  createRegionAction,
  updateRegionAction,
  deleteRegionAction,
  setTokenPositionAction,
  clearTokenPositionAction,
}: {
  mapId: string;
  imageUrl: string;
  initialPins: MapPin[];
  otherMaps: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  initialRegions: MapRegion[];
  initialTokens: AdminCharacterMapToken[];
  createPinAction: (x: number, y: number, label: string, targetMapId: string | null) => Promise<string>;
  updatePinAction: (pinId: string, x: number, y: number, label: string, targetMapId: string | null) => Promise<void>;
  deletePinAction: (pinId: string) => Promise<void>;
  createRegionAction: (locationId: string, x: number, y: number, width: number, height: number) => Promise<string>;
  updateRegionAction: (
    regionId: string,
    locationId: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => Promise<void>;
  deleteRegionAction: (regionId: string) => Promise<void>;
  setTokenPositionAction: (characterId: string, x: number, y: number) => Promise<void>;
  clearTokenPositionAction: (characterId: string) => Promise<{ x: number; y: number } | null>;
}) {
  const [pins, setPins] = useState<MapPin[]>(initialPins);
  const [regions, setRegions] = useState<MapRegion[]>(initialRegions);
  const [tokens, setTokens] = useState<AdminCharacterMapToken[]>(initialTokens);

  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState<"pin" | "region">("pin");
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [regionDraft, setRegionDraft] = useState<DraftRegion | null>(null);
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);

  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImageRatio(null);
  }, [imageUrl]);

  function fractionFromEvent(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  // ---- Pins ----------------------------------------------------------------

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || tool !== "pin" || draft) return;
    const { x, y } = fractionFromEvent(e.clientX, e.clientY);
    setDraft({ pinId: null, x, y, label: "", icon: "", targetMapId: "" });
  }

  function openExistingPin(pin: MapPin, e: React.MouseEvent) {
    e.stopPropagation();
    if (!editMode || tool !== "pin") return;
    setDraft({
      pinId: pin.id,
      x: pin.x,
      y: pin.y,
      label: pin.label ?? "",
      icon: pin.icon ?? "",
      targetMapId: pin.targetMapId ?? "",
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const targetMapId = draft.targetMapId || null;
    if (draft.pinId) {
      await updatePinAction(draft.pinId, draft.x, draft.y, draft.label, targetMapId);
      setPins((prev) =>
        prev.map((p) =>
          p.id === draft.pinId
            ? { ...p, label: draft.label || null, icon: draft.icon || null, targetMapId, x: draft.x, y: draft.y }
            : p
        )
      );
    } else {
      const newId = await createPinAction(draft.x, draft.y, draft.label, targetMapId);
      const targetMap = otherMaps.find((m) => m.id === targetMapId);
      setPins((prev) => [
        ...prev,
        {
          id: newId,
          mapId,
          x: draft.x,
          y: draft.y,
          label: draft.label || null,
          icon: draft.icon || null,
          targetMapId,
          targetMapName: targetMap?.name ?? null,
        },
      ]);
    }
    setDraft(null);
  }

  async function deleteDraft() {
    if (!draft?.pinId) return;
    await deletePinAction(draft.pinId);
    setPins((prev) => prev.filter((p) => p.id !== draft.pinId));
    setDraft(null);
  }

  // ---- Regions ---------------------------------------------------------

  function startDrawingRegion(e: React.PointerEvent<HTMLDivElement>) {
    if (!editMode || tool !== "region" || regionDraft) return;
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.regionSurface !== "1") return;
    const { x, y } = fractionFromEvent(e.clientX, e.clientY);
    setDrawingRect({ startX: x, startY: y, curX: x, curY: y });

    function onMove(ev: PointerEvent) {
      const { x: cx, y: cy } = fractionFromEvent(ev.clientX, ev.clientY);
      setDrawingRect((prev) => (prev ? { ...prev, curX: cx, curY: cy } : prev));
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const { x: endX, y: endY } = fractionFromEvent(ev.clientX, ev.clientY);
      setDrawingRect((prev) => {
        const startX = prev?.startX ?? x;
        const startY = prev?.startY ?? y;
        const rx = Math.min(startX, endX);
        const ry = Math.min(startY, endY);
        const rw = Math.abs(endX - startX);
        const rh = Math.abs(endY - startY);
        if (rw >= MIN_REGION_SIZE && rh >= MIN_REGION_SIZE) {
          setRegionDraft({ regionId: null, x: rx, y: ry, width: rw, height: rh, locationId: "" });
        }
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function openExistingRegion(region: MapRegion, e: React.MouseEvent) {
    e.stopPropagation();
    if (!editMode || tool !== "region") return;
    setRegionDraft({
      regionId: region.id,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      locationId: region.locationId,
    });
  }

  async function saveRegionDraft() {
    if (!regionDraft || !regionDraft.locationId) return;
    const { x, y, width, height, locationId } = regionDraft;
    if (regionDraft.regionId) {
      await updateRegionAction(regionDraft.regionId, locationId, x, y, width, height);
      const locationName = locations.find((l) => l.id === locationId)?.name ?? null;
      setRegions((prev) =>
        prev.map((r) => (r.id === regionDraft.regionId ? { ...r, x, y, width, height, locationId, locationName } : r))
      );
    } else {
      const newId = await createRegionAction(locationId, x, y, width, height);
      const locationName = locations.find((l) => l.id === locationId)?.name ?? null;
      setRegions((prev) => [...prev, { id: newId, mapId, x, y, width, height, locationId, locationName }]);
    }
    setRegionDraft(null);
  }

  async function deleteRegionDraft() {
    if (!regionDraft?.regionId) return;
    await deleteRegionAction(regionDraft.regionId);
    setRegions((prev) => prev.filter((r) => r.id !== regionDraft.regionId));
    setRegionDraft(null);
  }

  // ---- Character tokens (draggable in either tool mode) ------------------

  function startTokenDrag(e: React.PointerEvent, token: AdminCharacterMapToken) {
    if (!editMode) return;
    e.stopPropagation();
    e.preventDefault();
    setDraggingTokenId(token.characterId);
    let finalX = token.x ?? 0.5;
    let finalY = token.y ?? 0.5;

    function onMove(ev: PointerEvent) {
      const { x, y } = fractionFromEvent(ev.clientX, ev.clientY);
      finalX = x;
      finalY = y;
      setTokens((prev) => prev.map((t) => (t.characterId === token.characterId ? { ...t, x, y } : t)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraggingTokenId(null);
      setTokenPositionAction(token.characterId, finalX, finalY).catch(() => {});
      setTokens((prev) =>
        prev.map((t) => (t.characterId === token.characterId ? { ...t, isOverride: true } : t))
      );
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function resetToken(characterId: string) {
    const auto = await clearTokenPositionAction(characterId);
    setTokens((prev) =>
      prev.map((t) => (t.characterId === characterId ? { ...t, x: auto?.x ?? null, y: auto?.y ?? null, isOverride: false } : t))
    );
  }

  const placedTokens = tokens.filter((t) => t.x !== null && t.y !== null);
  const liveRect = drawingRect
    ? {
        x: Math.min(drawingRect.startX, drawingRect.curX),
        y: Math.min(drawingRect.startY, drawingRect.curY),
        width: Math.abs(drawingRect.curX - drawingRect.startX),
        height: Math.abs(drawingRect.curY - drawingRect.startY),
      }
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditMode((v) => !v);
              setDraft(null);
              setRegionDraft(null);
            }}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium ${
              editMode ? "border-gold bg-gold/20 text-gold" : "border-gold/40 text-gold hover:bg-gold/10"
            }`}
          >
            {editMode ? "Editing" : "Edit Pins & Regions"}
          </button>
          {editMode && (
            <div className="flex items-center gap-1 rounded-full border border-gold/20 p-0.5">
              <button
                type="button"
                onClick={() => setTool("pin")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  tool === "pin" ? "bg-gold/90 text-ink" : "text-gold/70 hover:bg-gold/10"
                }`}
              >
                Pins
              </button>
              <button
                type="button"
                onClick={() => setTool("region")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  tool === "region" ? "bg-gold/90 text-ink" : "text-gold/70 hover:bg-gold/10"
                }`}
              >
                Regions
              </button>
            </div>
          )}
        </div>
        <span className="text-xs text-parchment/40">
          {pins.length} pin{pins.length === 1 ? "" : "s"} · {regions.length} region
          {regions.length === 1 ? "" : "s"} · {placedTokens.length} token{placedTokens.length === 1 ? "" : "s"}
        </span>
      </div>
      {editMode && (
        <p className="text-xs text-parchment/40 mb-3">
          {tool === "pin"
            ? "Click the map to add a pin, click a pin to edit it."
            : "Click and drag on the map to draw a region, click a region to edit or delete it."}
          {" "}Character tokens (circular portraits) can always be dragged to reposition them manually.
        </p>
      )}

      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onPointerDown={startDrawingRegion}
        data-region-surface="1"
        className={`relative w-full overflow-hidden rounded-lg border border-gold/20 bg-void ${
          editMode ? (tool === "pin" ? "cursor-crosshair" : "cursor-crosshair") : ""
        }`}
        style={{ aspectRatio: imageRatio ? String(imageRatio) : "16 / 10" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-contain select-none"
          draggable={false}
          onLoad={(e) => setImageRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        />

        {tool === "region" &&
          regions.map((region) => (
            <div
              key={region.id}
              onClick={(e) => openExistingRegion(region, e)}
              className="absolute rounded border-2 border-ember/70 bg-ember/15 hover:bg-ember/25 cursor-pointer flex items-end p-1"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            >
              <span className="text-[10px] text-parchment bg-ink/70 rounded px-1 truncate max-w-full">
                {region.locationName ?? "Unnamed"}
              </span>
            </div>
          ))}

        {liveRect && (
          <div
            className="absolute rounded border-2 border-dashed border-gold bg-gold/15 pointer-events-none"
            style={{
              left: `${liveRect.x * 100}%`,
              top: `${liveRect.y * 100}%`,
              width: `${liveRect.width * 100}%`,
              height: `${liveRect.height * 100}%`,
            }}
          />
        )}

        {tool === "pin" &&
          pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              onClick={(e) => openExistingPin(pin, e)}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 rounded-full border-2 border-ink bg-gold text-ink text-xs shadow-lg hover:scale-125 transition-transform"
              style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              title={pin.label ?? ""}
            >
              {ICON_GLYPHS[pin.icon ?? ""] ?? "●"}
            </button>
          ))}

        {placedTokens.map((token) => (
          <div
            key={token.characterId}
            onPointerDown={(e) => startTokenDrag(e, token)}
            className={`group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center ${
              editMode ? "cursor-grab active:cursor-grabbing" : ""
            }`}
            style={{
              left: `${(token.x ?? 0) * 100}%`,
              top: `${(token.y ?? 0) * 100}%`,
              zIndex: draggingTokenId === token.characterId ? 30 : 20,
            }}
            title={token.name}
          >
            {token.portraitPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={token.portraitPath}
                alt={token.name}
                draggable={false}
                className={`h-8 w-8 rounded-full object-cover border-2 shadow-lg select-none ${
                  token.isOverride ? "border-sky-400" : "border-parchment"
                }`}
              />
            ) : (
              <div
                className={`h-8 w-8 rounded-full bg-void border-2 shadow-lg flex items-center justify-center text-[10px] text-parchment select-none ${
                  token.isOverride ? "border-sky-400" : "border-parchment"
                }`}
              >
                {token.name.slice(0, 1)}
              </div>
            )}
            {editMode && token.isOverride && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => resetToken(token.characterId)}
                className="hidden group-hover:block text-[9px] text-sky-300 hover:underline mt-0.5 bg-ink/80 rounded px-1"
              >
                Reset
              </button>
            )}
          </div>
        ))}

        {draft && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-40 w-64 rounded-lg border border-gold/40 bg-ink p-4 shadow-xl space-y-3"
            style={{
              left: `${Math.min(draft.x * 100, 70)}%`,
              top: `${Math.min(draft.y * 100, 60)}%`,
            }}
          >
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Label</span>
              <input
                className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-sm text-parchment"
                value={draft.label}
                onChange={(e) => setDraft((d) => (d ? { ...d, label: e.target.value } : d))}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Icon</span>
              <select
                className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-sm text-parchment"
                value={draft.icon}
                onChange={(e) => setDraft((d) => (d ? { ...d, icon: e.target.value } : d))}
              >
                {ICON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Navigate to</span>
              <select
                className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-sm text-parchment"
                value={draft.targetMapId}
                onChange={(e) => setDraft((d) => (d ? { ...d, targetMapId: e.target.value } : d))}
              >
                <option value="">&mdash; no target &mdash;</option>
                {otherMaps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between pt-1">
              {draft.pinId ? (
                <button type="button" onClick={deleteDraft} className="text-xs text-blood hover:underline">
                  Delete Pin
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="text-xs text-parchment/50 hover:text-parchment">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  className="rounded-full bg-gold/90 text-ink px-3 py-1 text-xs font-medium hover:bg-gold"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {regionDraft && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-40 w-64 rounded-lg border border-ember/50 bg-ink p-4 shadow-xl space-y-3"
            style={{
              left: `${Math.min(regionDraft.x * 100, 70)}%`,
              top: `${Math.min((regionDraft.y + regionDraft.height) * 100, 60)}%`,
            }}
          >
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Location</span>
              <select
                className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-sm text-parchment"
                value={regionDraft.locationId}
                onChange={(e) => setRegionDraft((d) => (d ? { ...d, locationId: e.target.value } : d))}
                autoFocus
              >
                <option value="">&mdash; choose a location &mdash;</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-parchment/40">
              Characters whose location resolves to this one will show a token in this area of the map.
            </p>
            <div className="flex items-center justify-between pt-1">
              {regionDraft.regionId ? (
                <button type="button" onClick={deleteRegionDraft} className="text-xs text-blood hover:underline">
                  Delete Region
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRegionDraft(null)}
                  className="text-xs text-parchment/50 hover:text-parchment"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveRegionDraft}
                  disabled={!regionDraft.locationId}
                  className="rounded-full bg-ember/90 text-ink px-3 py-1 text-xs font-medium hover:bg-ember disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
