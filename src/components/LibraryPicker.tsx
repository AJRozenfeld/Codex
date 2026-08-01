"use client";

import { useEffect, useRef, useState } from "react";
import type { PickerItem } from "@/lib/library-picker-actions";
import { searchLibrarySpells, searchLibraryWeapons, searchCreaturesForCampaign } from "@/lib/library-picker-actions";

// ---------------------------------------------------------------------------
// The LibraryPicker (2026-07-31): a search-as-you-type popup over the SRD
// libraries, used wherever an editor says "add a spell / weapon / creature".
// Two faces:
//  - LibraryPickerButton: opens the modal, hands the picked item to onPick
//    (character sheet editor - append a prefilled entry).
//  - LibraryPickerField: same modal, but the pick fills a hidden form input
//    so a plain server-action form can submit it (scene composer).
// ---------------------------------------------------------------------------

export type PickerKind = "spells" | "weapons" | "creatures";

const SEARCHERS: Record<PickerKind, (q: string) => Promise<PickerItem[]>> = {
  spells: searchLibrarySpells,
  weapons: searchLibraryWeapons,
  creatures: searchCreaturesForCampaign,
};

const TITLES: Record<PickerKind, string> = {
  spells: "Search the spell library",
  weapons: "Search the armory",
  creatures: "Search the bestiary",
};

function PickerModal({ kind, onPick, onClose }: { kind: PickerKind; onPick: (item: PickerItem) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await SEARCHERS[kind](q);
        if (seq.current === mine) setItems(results);
      } finally {
        if (seq.current === mine) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg border border-gold/30 bg-void shadow-card-hover overflow-hidden">
        <div className="p-3 border-b border-gold/15">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={TITLES[kind]}
            className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-gold/10">
          {loading && <p className="px-4 py-3 text-sm text-parchment/40">Searching…</p>}
          {!loading && items.length === 0 && <p className="px-4 py-3 text-sm text-parchment/40">Nothing found{q ? ` for "${q}"` : ""}.</p>}
          {!loading && items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => { onPick(it); onClose(); }}
              className="w-full text-left px-4 py-2.5 hover:bg-gold/10 transition-colors"
            >
              <span className="block text-parchment text-sm">{it.name}</span>
              {it.meta && <span className="block text-xs text-parchment/50">{it.meta}</span>}
            </button>
          ))}
          {!loading && items.length === 50 && (
            <p className="px-4 py-2 text-xs text-parchment/40 italic">Showing the first 50 - refine your search for more.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Opens the picker; hands the chosen item to onPick. For client editors. */
export function LibraryPickerButton({ kind, label, onPick, className }: {
  kind: PickerKind;
  label: string;
  onPick: (item: PickerItem) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "text-xs rounded-full border border-gold/40 text-gold px-3 py-1 hover:bg-gold/10"}
      >
        {label}
      </button>
      {open && <PickerModal kind={kind} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Picker that fills a hidden input so a plain server-action form can submit the id. */
export function LibraryPickerField({ kind, name, placeholder }: { kind: PickerKind; name: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickerItem | null>(null);
  return (
    <>
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-left focus:outline-none focus:border-gold/70"
      >
        {picked ? (
          <span className="text-parchment">{picked.name} <span className="text-parchment/40 text-xs">{picked.meta}</span></span>
        ) : (
          <span className="text-parchment/40">{placeholder}</span>
        )}
      </button>
      {open && <PickerModal kind={kind} onPick={setPicked} onClose={() => setOpen(false)} />}
    </>
  );
}
