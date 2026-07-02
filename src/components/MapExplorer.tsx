"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapEntity } from "@/lib/types";

const ICONS: Record<string, string> = {
  city: "●",
  ruin: "†",
  landmark: "★",
  dungeon: "▲",
  district: "■",
};

export function MapExplorer({ maps }: { maps: MapEntity[] }) {
  const mapById = useMemo(() => new Map(maps.map((m) => [m.id, m])), [maps]);
  const rootMap = maps.find((m) => m.isRoot) ?? maps[0];

  const [history, setHistory] = useState<string[]>(rootMap ? [rootMap.id] : []);
  const [zooming, setZooming] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [imageRatio, setImageRatio] = useState<number | null>(null);

  const currentId = history[history.length - 1];
  const current = currentId ? mapById.get(currentId) : undefined;

  // Reset to the fallback ratio whenever the map changes, so the box doesn't
  // briefly keep the previous map's shape while the new image loads.
  useEffect(() => {
    setImageRatio(null);
  }, [currentId]);

  if (!current) {
    return <p className="text-parchment/50">No maps have been revealed yet.</p>;
  }

  function goToPin(targetMapId: string, pinX: number, pinY: number) {
    if (!mapById.has(targetMapId) || zooming) return;
    setZoomOrigin(`${pinX * 100}% ${pinY * 100}%`);
    setZooming(true);
    setTimeout(() => {
      setHistory((h) => [...h, targetMapId]);
      setZooming(false);
    }, 450);
  }

  function goBack() {
    if (history.length <= 1) return;
    setHistory((h) => h.slice(0, -1));
  }

  function jumpTo(index: number) {
    setHistory((h) => h.slice(0, index + 1));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={goBack}
          disabled={history.length <= 1}
          className="rounded-full border border-gold/40 text-gold px-3 py-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gold/10"
        >
          &larr; Back
        </button>
        <span className="text-parchment/20">|</span>
        {history.map((id, i) => {
          const m = mapById.get(id);
          if (!m) return null;
          const isLast = i === history.length - 1;
          return (
            <span key={id} className="flex items-center gap-2">
              <button
                onClick={() => jumpTo(i)}
                className={`text-sm ${isLast ? "text-gold font-medium" : "text-parchment/50 hover:text-gold"}`}
              >
                {m.name}
              </button>
              {i < history.length - 1 && <span className="text-parchment/20 text-xs">&#9656;</span>}
            </span>
          );
        })}
      </div>

      <div
        className="relative w-full overflow-hidden rounded-lg border border-gold/20 bg-void"
        style={{ aspectRatio: imageRatio ? String(imageRatio) : "16 / 10" }}
      >
        <div
          className="absolute inset-0 transition-transform duration-[450ms] ease-in"
          style={{
            transformOrigin: zoomOrigin,
            transform: zooming ? "scale(4.5)" : "scale(1)",
            transitionTimingFunction: zooming ? "cubic-bezier(0.55, 0, 1, 0.45)" : "ease-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.imageUrl}
            alt={current.name}
            className="w-full h-full object-contain select-none"
            draggable={false}
            onLoad={(e) => setImageRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
          {!zooming &&
            (current.pins ?? []).map((pin) => (
              <button
                key={pin.id}
                onClick={() => pin.targetMapId && goToPin(pin.targetMapId, pin.x, pin.y)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group ${
                  pin.targetMapId ? "cursor-pointer" : "cursor-default"
                }`}
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                disabled={!pin.targetMapId}
              >
                <span
                  className={`flex items-center justify-center h-6 w-6 rounded-full border-2 text-xs shadow-lg transition-transform group-hover:scale-125 ${
                    pin.targetMapId ? "bg-gold border-ink text-ink" : "bg-parchment/40 border-ink/40 text-ink/60"
                  }`}
                >
                  {ICONS[pin.icon ?? ""] ?? "●"}
                </span>
                {pin.label && (
                  <span className="mt-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] text-parchment whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {pin.label}
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>
      {current.locationName && (
        <p className="text-xs text-parchment/40 mt-2">
          Linked to <span className="text-parchment/60">{current.locationName}</span>
        </p>
      )}
    </div>
  );
}
