"use client";

import { useEffect, useRef, useState } from "react";
import type { MapPin } from "@/lib/types";

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

export function MapPinEditor({
  mapId,
  imageUrl,
  initialPins,
  otherMaps,
  createPinAction,
  updatePinAction,
  deletePinAction,
}: {
  mapId: string;
  imageUrl: string;
  initialPins: MapPin[];
  otherMaps: { id: string; name: string }[];
  createPinAction: (x: number, y: number, label: string, targetMapId: string | null) => Promise<string>;
  updatePinAction: (pinId: string, x: number, y: number, label: string, targetMapId: string | null) => Promise<void>;
  deletePinAction: (pinId: string) => Promise<void>;
}) {
  const [pins, setPins] = useState<MapPin[]>(initialPins);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset to the fallback ratio whenever the map image changes, so the box
  // doesn't briefly keep the previous image's shape while the new one loads.
  useEffect(() => {
    setImageRatio(null);
  }, [imageUrl]);

  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || draft) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDraft({ pinId: null, x, y, label: "", icon: "", targetMapId: "" });
  }

  function openExistingPin(pin: MapPin, e: React.MouseEvent) {
    e.stopPropagation();
    if (!editMode) return;
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => {
            setEditMode((v) => !v);
            setDraft(null);
          }}
          className={`rounded-full border px-4 py-1.5 text-xs font-medium ${
            editMode ? "border-gold bg-gold/20 text-gold" : "border-gold/40 text-gold hover:bg-gold/10"
          }`}
        >
          {editMode ? "Editing: click map to add a pin, click a pin to edit" : "Edit Pins"}
        </button>
        <span className="text-xs text-parchment/40">{pins.length} pin{pins.length === 1 ? "" : "s"}</span>
      </div>

      <div
        ref={containerRef}
        onClick={handleImageClick}
        className={`relative w-full overflow-hidden rounded-lg border border-gold/20 bg-void ${editMode ? "cursor-crosshair" : ""}`}
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
        {pins.map((pin) => (
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

        {draft && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-10 w-64 rounded-lg border border-gold/40 bg-ink p-4 shadow-xl space-y-3"
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
      </div>
    </div>
  );
}
