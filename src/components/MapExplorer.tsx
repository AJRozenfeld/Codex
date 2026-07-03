"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MapEntity, CharacterMapToken } from "@/lib/types";

const ICONS: Record<string, string> = {
  city: "●",
  ruin: "†",
  landmark: "★",
  dungeon: "▲",
  district: "■",
};

export function MapExplorer({
  maps,
  onCurrentMapChange,
}: {
  maps: MapEntity[];
  onCurrentMapChange?: (map: MapEntity) => void;
}) {
  const mapById = useMemo(() => new Map(maps.map((m) => [m.id, m])), [maps]);
  const rootMap = maps.find((m) => m.isRoot) ?? maps[0];

  const [history, setHistory] = useState<string[]>(rootMap ? [rootMap.id] : []);
  const [zooming, setZooming] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  // Keyed by map id, so a map's ratio is measured once and reused instantly
  // on every later visit - no reset-and-remeasure flicker when navigating
  // back to a map, which was shifting pins relative to a briefly-wrong box
  // shape.
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const [activeToken, setActiveToken] = useState<CharacterMapToken | null>(null);

  const currentId = history[history.length - 1];
  const current = currentId ? mapById.get(currentId) : undefined;

  useEffect(() => {
    if (current) onCurrentMapChange?.(current);
    setActiveToken(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        style={{ aspectRatio: imageRatios[currentId] ? String(imageRatios[currentId]) : "16 / 10" }}
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
            onLoad={(e) => {
              const ratio = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
              setImageRatios((prev) => (prev[currentId] === ratio ? prev : { ...prev, [currentId]: ratio }));
            }}
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
          {!zooming &&
            (current.tokens ?? []).map((token) => (
              <button
                key={token.characterId}
                type="button"
                onClick={() => setActiveToken(token)}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
                style={{ left: `${token.x * 100}%`, top: `${token.y * 100}%` }}
                title={token.name}
              >
                {token.portraitPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={token.portraitPath}
                    alt={token.name}
                    draggable={false}
                    className="h-8 w-8 rounded-full object-cover border-2 border-parchment shadow-lg hover:scale-110 transition-transform"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-void border-2 border-parchment text-[10px] text-parchment shadow-lg hover:scale-110 transition-transform">
                    {token.name.slice(0, 1)}
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

      {activeToken && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
          onClick={() => setActiveToken(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-gold/30 bg-ink p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              {activeToken.portraitPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeToken.portraitPath}
                  alt={activeToken.name}
                  className="h-14 w-14 rounded-full object-cover border-2 border-gold/40"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-void border-2 border-gold/40 text-lg text-parchment">
                  {activeToken.name.slice(0, 1)}
                </span>
              )}
              <h3 className="font-display text-lg text-gold">{activeToken.name}</h3>
            </div>
            {activeToken.summary && <p className="mt-3 text-sm text-parchment/70">{activeToken.summary}</p>}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveToken(null)}
                className="text-xs text-parchment/50 hover:text-parchment"
              >
                Close
              </button>
              <Link
                href={`/characters/${activeToken.slug}`}
                className="rounded-full bg-gold/90 text-ink px-3 py-1 text-xs font-medium hover:bg-gold"
              >
                View Character
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
