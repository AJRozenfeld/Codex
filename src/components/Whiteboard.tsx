"use client";

import { useRef, useState } from "react";
import type { InheritableEntityType } from "@/lib/types";
import type { BoardItemWithPreview, LinkSearchResult } from "@/lib/board-queries";

const SWATCHES: { value: string | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: "#e0b34d", label: "Gold" },
  { value: "#c96a4f", label: "Ember" },
  { value: "#7fa87f", label: "Sage" },
  { value: "#6f95c9", label: "Sky" },
  { value: "#a374c9", label: "Violet" },
];

const TYPE_SHORT: Record<InheritableEntityType, string> = {
  moons: "Moon",
  regions: "Region",
  locations: "Location",
  factions: "Faction",
  characters: "Character",
  storylines: "Storyline",
  artifacts: "Artifact",
  timeline_events: "Event",
  maps: "Map",
};

const CANVAS_MIN_WIDTH = 2400;
const CANVAS_MIN_HEIGHT = 1400;

export function Whiteboard({
  initialItems,
  createItemAction,
  updatePositionAction,
  updateContentAction,
  updateColorAction,
  bringToFrontAction,
  deleteItemAction,
  searchLinkableAction,
}: {
  initialItems: BoardItemWithPreview[];
  createItemAction: (input: {
    type: "note" | "cheatsheet" | "link";
    x: number;
    y: number;
    entityType?: InheritableEntityType;
    entityId?: string;
  }) => Promise<BoardItemWithPreview>;
  updatePositionAction: (id: string, x: number, y: number, width: number, height: number) => Promise<void>;
  updateContentAction: (id: string, title: string, body: string) => Promise<void>;
  updateColorAction: (id: string, color: string | null) => Promise<void>;
  bringToFrontAction: (id: string) => Promise<void>;
  deleteItemAction: (id: string) => Promise<void>;
  searchLinkableAction: (query: string) => Promise<LinkSearchResult[]>;
}) {
  const [items, setItems] = useState<BoardItemWithPreview[]>(initialItems);
  const [frontId, setFrontId] = useState<string | null>(null);
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<LinkSearchResult[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasWidth = items.reduce((m, it) => Math.max(m, it.x + it.width + 200), CANVAS_MIN_WIDTH);
  const canvasHeight = items.reduce((m, it) => Math.max(m, it.y + it.height + 200), CANVAS_MIN_HEIGHT);

  function nextDropPosition() {
    const n = items.length;
    const step = 28;
    return { x: 40 + (n % 8) * step, y: 40 + (n % 8) * step };
  }

  async function handleAdd(type: "note" | "cheatsheet") {
    const pos = nextDropPosition();
    const created = await createItemAction({ type, x: pos.x, y: pos.y });
    setItems((prev) => [...prev, created]);
  }

  function handleLinkQueryChange(value: string) {
    setLinkQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!value.trim()) {
      setLinkResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      const results = await searchLinkableAction(value);
      setLinkResults(results);
    }, 200);
  }

  async function handlePickLinkResult(result: LinkSearchResult) {
    const pos = nextDropPosition();
    const created = await createItemAction({
      type: "link",
      x: pos.x,
      y: pos.y,
      entityType: result.entityType,
      entityId: result.entityId,
    });
    setItems((prev) => [...prev, created]);
    setLinkPanelOpen(false);
    setLinkQuery("");
    setLinkResults([]);
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await deleteItemAction(id);
  }

  async function handleColor(id: string, color: string | null) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, color } : it)));
    await updateColorAction(id, color);
  }

  async function handleSaveContent(id: string, title: string, body: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, title, body } : it)));
    await updateContentAction(id, title, body);
  }

  function startDrag(e: React.PointerEvent, item: BoardItemWithPreview) {
    e.preventDefault();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const originX = item.x;
    const originY = item.y;
    const originW = item.width;
    const originH = item.height;
    let finalX = originX;
    let finalY = originY;

    setFrontId(item.id);
    bringToFrontAction(item.id).catch(() => {});

    function onMove(ev: PointerEvent) {
      finalX = Math.max(0, originX + (ev.clientX - startClientX));
      finalY = Math.max(0, originY + (ev.clientY - startClientY));
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, x: finalX, y: finalY } : it)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      updatePositionAction(item.id, finalX, finalY, originW, originH).catch(() => {});
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(e: React.PointerEvent, item: BoardItemWithPreview) {
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const originW = item.width;
    const originH = item.height;
    let finalW = originW;
    let finalH = originH;

    function onMove(ev: PointerEvent) {
      finalW = Math.max(180, originW + (ev.clientX - startClientX));
      finalH = Math.max(100, originH + (ev.clientY - startClientY));
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, width: finalW, height: finalH } : it)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      updatePositionAction(item.id, item.x, item.y, finalW, finalH).catch(() => {});
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => handleAdd("note")}
          className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
        >
          + Sticky Note
        </button>
        <button
          type="button"
          onClick={() => handleAdd("cheatsheet")}
          className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
        >
          + Cheatsheet
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setLinkPanelOpen((v) => !v)}
            className="rounded-full bg-gold/90 text-ink px-3 py-1.5 text-xs font-medium hover:bg-gold"
          >
            + Link Article
          </button>
          {linkPanelOpen && (
            <div
              className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-gold/30 bg-ink shadow-xl z-50 p-3"
              suppressHydrationWarning
            >
              <input
                autoFocus
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={linkQuery}
                onChange={(e) => handleLinkQueryChange(e.target.value)}
                placeholder="Search characters, locations, factions..."
                className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment focus:outline-none focus:border-gold/70 mb-2"
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {linkQuery.trim() === "" && (
                  <p className="text-xs text-parchment/40 px-1">Start typing to find an article.</p>
                )}
                {linkQuery.trim() !== "" && linkResults.length === 0 && (
                  <p className="text-xs text-parchment/40 px-1">No matches.</p>
                )}
                {linkResults.map((r) => (
                  <button
                    key={`${r.entityType}-${r.entityId}`}
                    type="button"
                    onClick={() => handlePickLinkResult(r)}
                    className="w-full text-left rounded px-2 py-1.5 hover:bg-gold/10 flex items-center justify-between gap-2"
                  >
                    <span className="text-sm text-parchment truncate">{r.title}</span>
                    <span className="text-xs text-parchment/40 uppercase tracking-wide flex-shrink-0">
                      {TYPE_SHORT[r.entityType]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="text-xs text-parchment/30">Drag by the top strip &middot; resize from the corner</span>
      </div>

      <div className="card-static rounded-lg border border-gold/15 shadow-card overflow-auto" style={{ height: "70vh" }}>
        <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
          {items.map((item) => (
            <div
              key={item.id}
              className="absolute rounded-lg border bg-ink/95 shadow-lg flex flex-col overflow-hidden"
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                zIndex: item.id === frontId ? 9999 : item.zIndex,
                borderColor: item.color ?? "rgba(224,179,77,0.15)",
                borderLeftWidth: item.color ? 4 : 1,
              }}
            >
              <div
                onPointerDown={(e) => startDrag(e, item)}
                className="flex items-center justify-between px-2 py-1 bg-void/60 border-b border-gold/10 cursor-grab active:cursor-grabbing select-none"
              >
                <span className="text-[10px] uppercase tracking-widest text-parchment/40">
                  {item.type === "link" ? "Link" : item.type === "cheatsheet" ? "Cheatsheet" : "Note"}
                </span>
                <div className="flex items-center gap-1.5">
                  {item.type !== "link" &&
                    SWATCHES.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        title={s.label}
                        onClick={() => handleColor(item.id, s.value)}
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: s.value ?? "transparent" }}
                      />
                    ))}
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="text-parchment/40 hover:text-blood text-xs leading-none px-1"
                  >
                    &#10005;
                  </button>
                </div>
              </div>

              {item.type === "link" ? (
                <LinkCardBody item={item} />
              ) : (
                <NoteCardBody item={item} onSave={(title, body) => handleSaveContent(item.id, title, body)} />
              )}

              <div
                onPointerDown={(e) => startResize(e, item)}
                className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
                style={{ background: "linear-gradient(135deg, transparent 50%, rgba(224,179,77,0.4) 50%)" }}
              />
            </div>
          ))}
          {items.length === 0 && (
            <p className="p-6 text-sm text-parchment/40">
              Empty board. Add a sticky note, a cheatsheet, or link in an article to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteCardBody({
  item,
  onSave,
}: {
  item: BoardItemWithPreview;
  onSave: (title: string, body: string) => void;
}) {
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body ?? "");

  return (
    <div className="flex flex-col flex-1 min-h-0" suppressHydrationWarning>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onSave(title, body)}
        placeholder={item.type === "cheatsheet" ? "Cheatsheet title..." : "Untitled note"}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore
        className="bg-transparent text-sm font-medium text-parchment px-2 pt-2 focus:outline-none placeholder:text-parchment/30"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => onSave(title, body)}
        placeholder="Write here..."
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore
        className="flex-1 bg-transparent text-xs text-parchment/80 px-2 py-1 resize-none focus:outline-none placeholder:text-parchment/30"
      />
    </div>
  );
}

function LinkCardBody({ item }: { item: BoardItemWithPreview }) {
  if (!item.preview) {
    return (
      <div className="flex-1 flex items-center justify-center px-3 text-center text-xs text-parchment/40 italic">
        This article no longer exists.
      </div>
    );
  }
  const { title, subtitle, imageUrl, href } = item.preview;
  return (
    <a href={href} className="flex-1 flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={title} className="h-12 w-12 rounded object-cover border border-gold/20 flex-shrink-0" />
      ) : (
        <div className="h-12 w-12 rounded border border-gold/20 bg-void/60 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-sm text-parchment truncate">{title}</div>
        {subtitle && <div className="text-xs text-parchment/50 truncate">{subtitle}</div>}
      </div>
    </a>
  );
}
