"use client";

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// The creation wizard's equipment & spell steps (2026-08-04): search-as-you-
// filter lists with a LIVE running total (gold spent / spells chosen), so a
// player sees their budget move as they shop. Selection state lives here;
// hidden inputs carry the chosen ids so the surrounding plain server-action
// form submits unchanged, and the server re-validates everything regardless.
// ---------------------------------------------------------------------------

const inputCls = "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm placeholder:text-parchment/40 focus:outline-none focus:border-gold/70";

export interface WizardEquipmentRow { id: string; name: string; category: string | null; cost: string | null; statLine: string; gold: number }

export function WizardEquipmentPicker({ rows, budget, maxItems, initialSelected }: {
  rows: WizardEquipmentRow[];
  budget: number;
  maxItems: number;
  initialSelected: string[];
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set(initialSelected));
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const spent = [...sel].reduce((s, id) => s + (byId.get(id)?.gold ?? 0), 0);
  const over = spent > budget || sel.size > maxItems;
  const needle = q.trim().toLowerCase();
  const visible = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;

  return (
    <div className="space-y-3">
      {[...sel].map((id) => <input key={id} type="hidden" name="itemId" value={id} />)}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the armory…" className={inputCls + " flex-1 min-w-[12rem]"} />
        <span className={`text-sm whitespace-nowrap ${over ? "text-blood font-semibold" : "text-parchment/70"}`}>
          {spent.toFixed(spent % 1 ? 1 : 0)} / {budget} gp · {sel.size}/{maxItems} items
        </span>
      </div>
      {over && <p className="text-xs text-blood">Over the limit - put something back before continuing.</p>}
      <div className="max-h-96 overflow-y-auto rounded-lg border border-gold/15 divide-y divide-gold/10">
        {visible.map((it) => (
          <label key={it.id} className="flex items-center gap-3 px-3 py-2 hover:bg-void/40 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={sel.has(it.id)}
              onChange={(e) => setSel((prev) => {
                const n = new Set(prev);
                if (e.target.checked) n.add(it.id); else n.delete(it.id);
                return n;
              })}
              className="accent-[#6e1f14]"
            />
            <span className="flex-1 text-parchment">{it.name}</span>
            <span className="text-parchment/40 text-xs hidden sm:block">{it.statLine}</span>
            <span className="text-parchment/60 w-16 text-right">{it.cost ?? "—"}</span>
          </label>
        ))}
        {visible.length === 0 && <p className="px-3 py-3 text-sm text-parchment/40">Nothing found{q ? ` for "${q}"` : ""}.</p>}
      </div>
      <button type="submit" disabled={over} className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed">
        Save &amp; Continue
      </button>
    </div>
  );
}

export interface WizardSpellRow { id: string; name: string; level: number; school: string | null }

export function WizardSpellPicker({ rows, maxSpells, initialSelected }: {
  rows: WizardSpellRow[];
  maxSpells: number;
  initialSelected: string[];
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set(initialSelected));
  const over = sel.size > maxSpells;
  const needle = q.trim().toLowerCase();
  const visible = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;

  return (
    <div className="space-y-3">
      {[...sel].map((id) => <input key={id} type="hidden" name="spellId" value={id} />)}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the grimoire…" className={inputCls + " flex-1 min-w-[12rem]"} />
        <span className={`text-sm whitespace-nowrap ${over ? "text-blood font-semibold" : "text-parchment/70"}`}>
          {sel.size}/{maxSpells} spells
        </span>
      </div>
      {over && <p className="text-xs text-blood">Too many spells - unlearn one before continuing.</p>}
      <div className="max-h-96 overflow-y-auto rounded-lg border border-gold/15 divide-y divide-gold/10">
        {visible.map((sp) => (
          <label key={sp.id} className="flex items-center gap-3 px-3 py-2 hover:bg-void/40 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={sel.has(sp.id)}
              onChange={(e) => setSel((prev) => {
                const n = new Set(prev);
                if (e.target.checked) n.add(sp.id); else n.delete(sp.id);
                return n;
              })}
              className="accent-[#6e1f14]"
            />
            <span className="flex-1 text-parchment">{sp.name}</span>
            <span className="text-parchment/40 text-xs">{sp.level === 0 ? "Cantrip" : `Level ${sp.level}`}{sp.school ? ` · ${sp.school}` : ""}</span>
          </label>
        ))}
        {visible.length === 0 && <p className="px-3 py-3 text-sm text-parchment/40">Nothing found{q ? ` for "${q}"` : ""}.</p>}
      </div>
      <button type="submit" disabled={over} className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed">
        Save &amp; Continue
      </button>
    </div>
  );
}
