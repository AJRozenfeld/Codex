"use client";

import { useEffect, useRef, useState } from "react";
import type { MapPin, MapRegion, MapRegionPoint, AdminCharacterMapToken } from "@/lib/types";

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
  points: MapRegionPoint[];
  locationId: string;
}

// Regions are drawn by clicking one vertex at a time (2026-07-06, Aviv's
// call): a rubber-band line previews the next edge as the mouse moves, and
// the shape closes either by clicking back near the first vertex or via the
// "Finish Shape" button once at least MIN_POLYGON_POINTS vertices are down.
// This replaced the old click-and-drag rectangle tool so a region can trace
// an irregular location shape instead of being forced into an axis-aligned
// box. The polygon is stored as an ordered list of fractional (0..1)
// vertices; the shape implicitly closes from the last point back to the
// first, so we never store the first point twice.
const MIN_POLYGON_POINTS = 3;
// How close (in fractional 0..1 units) a click needs to land to the first
// vertex before it's treated as "close the shape" rather than "add a point".
const CLOSE_THRESHOLD = 0.025;

function averagePoint(points: MapRegionPoint[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function distance(a: MapRegionPoint, b: MapRegionPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointsToPolygonAttr(points: MapRegionPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

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
  createRegionAction: (locationId: string, points: { x: number; y: number }[]) => Promise<string>;
  updateRegionAction: (regionId: string, locationId: string, points: { x: number; y: number }[]) => Promise<void>;
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
  const [polygonPoints, setPolygonPoints] = useState<MapRegionPoint[]>([]);
  const [cursorPos, setCursorPos] = useState<MapRegionPoint | null>(null);
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
    if (!editMode) return;
    if (tool === "pin") {
      if (draft) return;
      const { x, y } = fractionFromEvent(e.clientX, e.clientY);
      setDraft({ pinId: null, x, y, label: "", icon: "", targetMapId: "" });
      return;
    }
    handleRegionClick(e);
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

  // ---- Regions (polygon vertex-click tool) ---------------------------------

  // Set while reshaping an existing region (via "Redraw Shape") so the next
  // completed polygon is saved back onto that region's id/location instead
  // of creating a new one.
  const redrawTargetRef = useRef<{ regionId: string | null; locationId: string } | null>(null);

  function resetRegionDrawing() {
    setPolygonPoints([]);
    setCursorPos(null);
  }

  function closePolygon(points: MapRegionPoint[]) {
    if (points.length < MIN_POLYGON_POINTS) return;
    const target = redrawTargetRef.current;
    redrawTargetRef.current = null;
    resetRegionDrawing();
    setRegionDraft({
      regionId: target?.regionId ?? null,
      points,
      locationId: target?.locationId ?? "",
    });
  }

  function handleRegionClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || tool !== "region") return;
    if (regionDraft) return; // a finished-shape popup is open - don't start another
    const target = e.target as HTMLElement;
    if (e.target !== containerRef.current && target.dataset.regionSurface !== "1") return;

    const pt = fractionFromEvent(e.clientX, e.clientY);

    if (polygonPoints.length >= MIN_POLYGON_POINTS && distance(pt, polygonPoints[0]) < CLOSE_THRESHOLD) {
      closePolygon(polygonPoints);
      return;
    }

    setPolygonPoints((prev) => [...prev, pt]);
  }

  function handleRegionMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || tool !== "region" || polygonPoints.length === 0) return;
    setCursorPos(fractionFromEvent(e.clientX, e.clientY));
  }

  function finishPolygon(e: React.MouseEvent) {
    e.stopPropagation();
    closePolygon(polygonPoints);
  }

  function cancelPolygon(e: React.MouseEvent) {
    e.stopPropagation();
    resetRegionDrawing();
  }

  function openExistingRegion(region: MapRegion, e: React.MouseEvent) {
    e.stopPropagation();
    if (!editMode || tool !== "region") return;
    setRegionDraft({ regionId: region.id, points: region.points, locationId: region.locationId });
  }

  function redrawRegion() {
    if (!regionDraft) return;
    redrawTargetRef.current = { regionId: regionDraft.regionId, locationId: regionDraft.locationId };
    setRegionDraft(null);
    resetRegionDrawing();
  }

  async function saveRegionDraft() {
    if (!regionDraft || !regionDraft.locationId || regionDraft.points.length < MIN_POLYGON_POINTS) return;
    const { points, locationId } = regionDraft;
    if (regionDraft.regionId) {
      await updateRegionAction(regionDraft.regionId, locationId, points);
      const locationName = locations.find((l) => l.id === locationId)?.name ?? null;
      setRegions((prev) =>
        prev.map((r) => (r.id === regionDraft.regionId ? { ...r, points, locationId, locationName } : r))
      );
    } else {
      const newId = await createRegionAction(locationId, points);
      const locationName = locations.find((l) => l.id === locationId)?.name ?? null;
      setRegions((prev) => [...prev, { id: newId, mapId, points, locationId, locationName }]);
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
  const previewPoints = cursorPos ? [...polygonPoints, cursorPos] : polygonPoints;

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
              resetRegionDrawing();
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
                onClick={() => {
                  setTool("pin");
                  setRegionDraft(null);
                  resetRegionDrawing();
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  tool === "pin" ? "bg-gold/90 text-ink" : "text-gold/70 hover:bg-gold/10"
                }`}
              >
                Pins
              </button>
              <button
                type="button"
                onClick={() => {
                  setTool("region");
                  setDraft(null);
                }}
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
            : "Click to place vertices; click near the first point (or press Finish Shape) to close the region. Click an existing region to edit or delete it."}
          {" "}Character tokens (circular portraits) can always be dragged to reposition them manually.
        </p>
      )}

      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onMouseMove={handleRegionMouseMove}
        data-region-surface="1"
        className={`relative w-full overflow-hidden rounded-lg border border-gold/20 bg-void ${
          editMode ? "cursor-crosshair" : ""
        }`}
        style={{ aspectRatio: imageRatio ? String(imageRatio) : "16 / 10" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          data-region-surface="1"
          className="w-full h-full object-contain select-none"
          draggable={false}
          onLoad={(e) => setImageRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        />

        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          {tool === "region" &&
            regions.map((region) => (
              <polygon
                key={region.id}
                points={pointsToPolygonAttr(region.points)}
                fill="rgba(217, 119, 6, 0.15)"
                stroke="rgb(217, 119, 6)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => openExistingRegion(region, e as unknown as React.MouseEvent)}
              />
            ))}

          {tool === "region" && polygonPoints.length > 0 && (
            <polyline
              points={pointsToPolygonAttr(previewPoints)}
              fill="none"
              stroke="rgb(251, 191, 36)"
              strokeWidth={1.5}
              strokeDasharray="0.01,0.008"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {tool === "region" &&
            polygonPoints.map((p, i) => (
              // r is in viewBox units (the whole canvas is 1x1, not pixels) -
              // these need to be small fractions, not the "5"/"3.5" pixel-ish
              // radii it originally shipped with, which rendered as circles
              // several times wider than the entire map (looked like the
              // whole image flashing solid yellow, then solid white on top
              // of it once a second point existed - 2026-07-06 bug).
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === 0 ? 0.012 : 0.008}
                fill={i === 0 ? "rgb(251, 191, 36)" : "white"}
                stroke="rgb(120, 53, 15)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>

        {tool === "region" &&
          regions.map((region) => {
            const center = averagePoint(region.points);
            return (
              <span
                key={region.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] text-parchment bg-ink/70 rounded px-1 truncate max-w-[80%] pointer-events-none"
                style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
              >
                {region.locationName ?? "Unnamed"}
              </span>
            );
          })}

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

        {tool === "region" && polygonPoints.length >= MIN_POLYGON_POINTS && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-40">
            <button
              type="button"
              onClick={finishPolygon}
              className="rounded-full bg-gold/90 text-ink px-3 py-1.5 text-xs font-medium hover:bg-gold"
            >
              Finish Shape
            </button>
            <button
              type="button"
              onClick={cancelPolygon}
              className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
            >
              Cancel
            </button>
          </div>
        )}
        {tool === "region" && polygonPoints.length > 0 && polygonPoints.length < MIN_POLYGON_POINTS && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40">
            <button
              type="button"
              onClick={cancelPolygon}
              className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
            >
              Cancel
            </button>
          </div>
        )}

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
              left: `${Math.min(Math.min(...regionDraft.points.map((p) => p.x)) * 100, 70)}%`,
              top: `${Math.min(Math.max(...regionDraft.points.map((p) => p.y)) * 100, 60)}%`,
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
                <button type="button" onClick={redrawRegion} className="text-xs text-parchment/50 hover:text-parchment">
                  Redraw Shape
                </button>
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
