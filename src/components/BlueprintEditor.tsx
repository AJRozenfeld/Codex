"use client";

import { useState, useTransition } from "react";
import {
  type BlueprintStep, type StatMethod, type ChoiceOption, type TextPrompt, type AbilityKey,
  ABILITIES, DEFAULT_POINT_BUY_COST, newStepId, statMethodSummary,
} from "@/lib/blueprint-shared";

// ---------------------------------------------------------------------------
// The DM's blueprint editor (client-side): the whole steps array lives in
// state, every control edits it in place, and Save posts one JSON field to
// the server action, which sanitizes before persisting. Mirrors the
// CharacterSheetForm pattern (client state -> hidden JSON -> server action).
// ---------------------------------------------------------------------------

const inputCls = "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm focus:outline-none focus:border-gold/70";
const smallCls = "w-20 rounded bg-void border border-gold/30 px-2 py-1 text-parchment text-sm text-center";
const btnCls = "rounded-full border border-gold/40 text-gold px-3 py-1 text-xs hover:bg-gold/10";

function StatMethodEditor({ method, onChange }: { method: StatMethod; onChange: (m: StatMethod) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["pointBuy", "array", "rolled", "manual"] as const).map((k) => (
          <button
            key={k} type="button"
            onClick={() => {
              if (k === method.kind) return;
              if (k === "pointBuy") onChange({ kind: "pointBuy", budget: 27, min: 8, max: 15, costTable: { ...DEFAULT_POINT_BUY_COST } });
              else if (k === "array") onChange({ kind: "array", values: [15, 14, 13, 12, 10, 8] });
              else if (k === "rolled") onChange({ kind: "rolled", count: 4, die: 6, dropLowest: 1, assignFreely: true });
              else onChange({ kind: "manual", min: 3, max: 18 });
            }}
            className={`rounded-full px-3 py-1 text-xs border ${method.kind === k ? "bg-gold/90 text-ink border-gold" : "border-gold/30 text-parchment/70 hover:bg-gold/10"}`}
          >
            {{ pointBuy: "Point Buy", array: "Standard Array", rolled: "Rolled", manual: "Manual" }[k]}
          </button>
        ))}
      </div>
      <p className="text-xs text-parchment/50 italic">{statMethodSummary(method)}</p>
      {method.kind === "pointBuy" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label>Budget <input type="number" value={method.budget} onChange={(e) => onChange({ ...method, budget: Number(e.target.value) || 0 })} className={smallCls} /></label>
            <label>Min <input type="number" value={method.min} onChange={(e) => onChange({ ...method, min: Number(e.target.value) || 1 })} className={smallCls} /></label>
            <label>Max <input type="number" value={method.max} onChange={(e) => onChange({ ...method, max: Number(e.target.value) || 1 })} className={smallCls} /></label>
          </div>
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="text-ember/80 uppercase tracking-widest">Cost table:</span>
            {Object.keys(method.costTable).sort((a, b) => Number(a) - Number(b)).map((score) => (
              <label key={score} className="inline-flex items-center gap-1">
                {score}→
                <input type="number" value={method.costTable[score]} onChange={(e) => onChange({ ...method, costTable: { ...method.costTable, [score]: Number(e.target.value) || 0 } })} className="w-14 rounded bg-void border border-gold/30 px-1 py-0.5 text-parchment text-center" />
              </label>
            ))}
          </div>
        </div>
      )}
      {method.kind === "array" && (
        <div className="flex flex-wrap gap-2 text-xs items-center">
          <span className="text-ember/80 uppercase tracking-widest">Values:</span>
          {method.values.map((v, i) => (
            <input key={i} type="number" value={v} onChange={(e) => {
              const values = [...method.values]; values[i] = Number(e.target.value) || 0; onChange({ ...method, values });
            }} className={smallCls} />
          ))}
        </div>
      )}
      {method.kind === "rolled" && (
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label>Dice <input type="number" value={method.count} onChange={(e) => onChange({ ...method, count: Number(e.target.value) || 1 })} className={smallCls} /></label>
          <label>Die size <input type="number" value={method.die} onChange={(e) => onChange({ ...method, die: Number(e.target.value) || 2 })} className={smallCls} /></label>
          <label>Drop lowest <input type="number" value={method.dropLowest} onChange={(e) => onChange({ ...method, dropLowest: Number(e.target.value) || 0 })} className={smallCls} /></label>
          <label className="inline-flex items-center gap-1 pb-1">
            <input type="checkbox" checked={method.assignFreely} onChange={(e) => onChange({ ...method, assignFreely: e.target.checked })} className="accent-[#6e1f14]" />
            assign freely
          </label>
        </div>
      )}
      {method.kind === "manual" && (
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label>Min <input type="number" value={method.min} onChange={(e) => onChange({ ...method, min: Number(e.target.value) || 1 })} className={smallCls} /></label>
          <label>Max <input type="number" value={method.max} onChange={(e) => onChange({ ...method, max: Number(e.target.value) || 1 })} className={smallCls} /></label>
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: ChoiceOption[]; onChange: (o: ChoiceOption[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={o.id} className="rounded border border-gold/15 p-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setOpen(open === o.id ? null : o.id)} className="text-gold text-xs">{open === o.id ? "▾" : "▸"}</button>
            <input value={o.name} placeholder="Option name" onChange={(e) => { const n = [...options]; n[i] = { ...o, name: e.target.value }; onChange(n); }} className={inputCls + " flex-1"} />
            <span className="text-xs text-parchment/40 whitespace-nowrap">
              {o.statEffects && Object.keys(o.statEffects).length > 0
                ? Object.entries(o.statEffects).map(([k, v]) => `${v! > 0 ? "+" : ""}${v} ${k}`).join(", ")
                : ""}
            </span>
            <button type="button" onClick={() => onChange(options.filter((x) => x.id !== o.id))} className="text-blood text-xs hover:underline">Remove</button>
          </div>
          {open === o.id && (
            <div className="mt-2 space-y-2">
              <textarea value={o.description} placeholder="Description shown to the player" rows={2} onChange={(e) => { const n = [...options]; n[i] = { ...o, description: e.target.value }; onChange(n); }} className={inputCls} />
              <div className="flex flex-wrap gap-2 text-xs items-center">
                <span className="text-ember/80 uppercase tracking-widest">Stat effects:</span>
                {ABILITIES.map((a) => (
                  <label key={a} className="inline-flex items-center gap-1 uppercase">
                    {a}
                    <input
                      type="number"
                      value={o.statEffects?.[a] ?? 0}
                      onChange={(e) => {
                        const eff: Partial<Record<AbilityKey, number>> = { ...(o.statEffects ?? {}) };
                        const v = Number(e.target.value) || 0;
                        if (v === 0) delete eff[a]; else eff[a] = v;
                        const n = [...options]; n[i] = { ...o, statEffects: eff }; onChange(n);
                      }}
                      className="w-12 rounded bg-void border border-gold/30 px-1 py-0.5 text-parchment text-center"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...options, { id: newStepId(), name: "", description: "" }])} className={btnCls}>+ Add option</button>
    </div>
  );
}

function PromptsEditor({ prompts, onChange }: { prompts: TextPrompt[]; onChange: (p: TextPrompt[]) => void }) {
  return (
    <div className="space-y-2">
      {prompts.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded border border-gold/15 p-2 text-xs">
          <input value={p.label} placeholder="Prompt label" onChange={(e) => { const n = [...prompts]; n[i] = { ...p, label: e.target.value }; onChange(n); }} className={inputCls + " flex-1 min-w-[10rem]"} />
          <select value={p.target} onChange={(e) => { const n = [...prompts]; n[i] = { ...p, target: e.target.value as TextPrompt["target"] }; onChange(n); }} className="rounded bg-void border border-gold/30 px-2 py-1 text-parchment">
            {["name", "summary", "bio", "personality", "ideals", "bonds", "flaws", "free"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.long} onChange={(e) => { const n = [...prompts]; n[i] = { ...p, long: e.target.checked }; onChange(n); }} className="accent-[#6e1f14]" /> long</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={p.required} onChange={(e) => { const n = [...prompts]; n[i] = { ...p, required: e.target.checked }; onChange(n); }} className="accent-[#6e1f14]" /> required</label>
          <button type="button" onClick={() => onChange(prompts.filter((x) => x.id !== p.id))} className="text-blood hover:underline">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...prompts, { id: newStepId(), label: "", long: false, required: false, target: "free" }])} className={btnCls}>+ Add prompt</button>
    </div>
  );
}

const KIND_LABEL: Record<BlueprintStep["kind"], string> = {
  stats: "Ability Scores", choice: "Choice", equipment: "Equipment", spells: "Spells", text: "Text Prompts",
};

export function BlueprintEditor({
  initialEnabled, initialSteps, saveAction,
}: {
  initialEnabled: boolean;
  initialSteps: BlueprintStep[];
  saveAction: (formData: FormData) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [steps, setSteps] = useState<BlueprintStep[]>(initialSteps);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (i: number, s: BlueprintStep) => setSteps((prev) => prev.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: number) => setSteps((prev) => {
    const n = [...prev]; const j = i + d;
    if (j < 0 || j >= n.length) return prev;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  const addStep = (kind: BlueprintStep["kind"]) => {
    const id = newStepId();
    const step: BlueprintStep =
      kind === "stats" ? { id, kind, title: "Ability Scores", method: { kind: "pointBuy", budget: 27, min: 8, max: 15, costTable: { ...DEFAULT_POINT_BUY_COST } } }
      : kind === "choice" ? { id, kind, title: "Choice", prompt: "", sheetTarget: "none", options: [] }
      : kind === "equipment" ? { id, kind, title: "Starting Equipment", goldBudget: 100, maxItems: 15, categories: ["Weapon", "Armor", "Adventuring Gear", "Tools"] }
      : kind === "spells" ? { id, kind, title: "Spells", maxSpells: 4, maxLevel: 1 }
      : { id, kind: "text", title: "Identity", prompts: [{ id: newStepId(), label: "Character Name", long: false, required: true, target: "name" }] };
    setSteps((prev) => [...prev, step]);
  };

  return (
    <form
      action={(fd) => {
        fd.set("enabled", enabled ? "1" : "0");
        fd.set("steps", JSON.stringify(steps));
        startTransition(async () => { await saveAction(fd); setSaved(true); setTimeout(() => setSaved(false), 2500); });
      }}
      className="space-y-5"
    >
      <label className="flex items-center gap-3 rounded-lg border border-gold/20 p-4">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[#6e1f14] h-4 w-4" />
        <span className="text-parchment">
          <span className="font-semibold">Character creation is {enabled ? "open" : "closed"}.</span>{" "}
          <span className="text-parchment/50 text-sm">When open, players without a character can walk the steps below and submit a draft for your approval.</span>
        </span>
      </label>

      {steps.map((step, i) => (
        <div key={step.id} className="rounded-lg border border-gold/20 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-widest text-ember/80">{i + 1}. {KIND_LABEL[step.kind]}</span>
            <input value={step.title} onChange={(e) => update(i, { ...step, title: e.target.value })} className={inputCls + " flex-1 min-w-[10rem]"} />
            <button type="button" onClick={() => move(i, -1)} className={btnCls}>↑</button>
            <button type="button" onClick={() => move(i, 1)} className={btnCls}>↓</button>
            <button type="button" onClick={() => setSteps((prev) => prev.filter((x) => x.id !== step.id))} className="text-blood text-xs hover:underline">Delete step</button>
          </div>
          {step.kind === "stats" && <StatMethodEditor method={step.method} onChange={(method) => update(i, { ...step, method })} />}
          {step.kind === "choice" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex-1 min-w-[12rem]">Prompt <input value={step.prompt} onChange={(e) => update(i, { ...step, prompt: e.target.value })} className={inputCls} /></label>
                <label>Fills sheet field{" "}
                  <select value={step.sheetTarget} onChange={(e) => update(i, { ...step, sheetTarget: e.target.value as typeof step.sheetTarget })} className="rounded bg-void border border-gold/30 px-2 py-1 text-parchment">
                    {["race", "class", "background", "none"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <OptionsEditor options={step.options} onChange={(options) => update(i, { ...step, options })} />
            </div>
          )}
          {step.kind === "equipment" && (
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label>Gold budget <input type="number" value={step.goldBudget} onChange={(e) => update(i, { ...step, goldBudget: Number(e.target.value) || 0 })} className={smallCls} /></label>
              <label>Max items <input type="number" value={step.maxItems} onChange={(e) => update(i, { ...step, maxItems: Number(e.target.value) || 1 })} className={smallCls} /></label>
              <label className="flex-1 min-w-[14rem]">Categories (comma-separated, blank = all)
                <input value={step.categories.join(", ")} onChange={(e) => update(i, { ...step, categories: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} className={inputCls} />
              </label>
            </div>
          )}
          {step.kind === "spells" && (
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label>Max spells <input type="number" value={step.maxSpells} onChange={(e) => update(i, { ...step, maxSpells: Number(e.target.value) || 0 })} className={smallCls} /></label>
              <label>Max spell level <input type="number" value={step.maxLevel} onChange={(e) => update(i, { ...step, maxLevel: Number(e.target.value) || 0 })} className={smallCls} /></label>
            </div>
          )}
          {step.kind === "text" && <PromptsEditor prompts={step.prompts} onChange={(prompts) => update(i, { ...step, prompts })} />}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-ember/80">Add step:</span>
        {(["stats", "choice", "equipment", "spells", "text"] as const).map((k) => (
          <button key={k} type="button" onClick={() => addStep(k)} className={btnCls}>+ {KIND_LABEL[k]}</button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold disabled:opacity-50">
          {pending ? "Saving..." : "Save Blueprint"}
        </button>
        {saved && <span className="text-sm text-gold">Saved.</span>}
      </div>
    </form>
  );
}
