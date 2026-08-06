"use client";

import { useMemo, useState } from "react";
import {
  defaultSheetDataForTemplate,
  makeSheetResolver,
  sanitizeSheetTemplate,
  type SheetFeatures,
  type SheetTemplateDef,
} from "@/lib/sheet-engine";
import { validateSheetTemplate, type TemplateIssue } from "@/lib/sheet-template-validate";

// ---------------------------------------------------------------------------
// The sheet-system editor (Sheet Engine Phase B, 2026-08-06). The DM edits a
// SheetTemplateDef directly - abilities, skills, roll variables, derived
// formulas (typed as text, Aviv's call), section features - with a LIVE
// preview column: every variable and formula is evaluated on each keystroke
// against a sample character built from this very template, so a typo shows
// its face immediately instead of on a player's sheet. The finished
// definition rides a hidden JSON input into the server action, which
// sanitizes and re-validates (editor output is a claim, not a fact) -
// nothing broken can be saved. Same architecture as BlueprintEditor.
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-2.5 py-1.5 text-parchment text-sm focus:outline-none focus:border-gold/70";
const tinyCls = "rounded bg-void border border-gold/30 px-2 py-1 text-parchment text-xs focus:outline-none focus:border-gold/70";
const labelCls = "block text-[10px] uppercase tracking-widest text-ember/80 mb-1";
const smallBtn = "text-xs rounded-full border border-gold/40 text-gold px-3 py-1 hover:bg-gold/10";
const removeBtn = "text-xs text-blood hover:underline";

const FEATURE_LABELS: { key: keyof SheetFeatures; label: string; hint: string }[] = [
  { key: "spellcasting", label: "Spellcasting", hint: "spell list, slots, casting stats" },
  { key: "attacks", label: "Attacks & weapons", hint: "the rollable arsenal" },
  { key: "customActions", label: "Custom actions", hint: "class features & rollable tricks" },
  { key: "deathSaves", label: "Death saves", hint: "the three-pip death spiral" },
  { key: "hitDice", label: "Hit dice", hint: "recovery pools" },
  { key: "inspiration", label: "Inspiration", hint: "the golden checkbox" },
  { key: "experiencePoints", label: "Experience points", hint: "XP tracking" },
  { key: "alignment", label: "Alignment", hint: "the nine-box compass" },
  { key: "equipment", label: "Equipment & currency", hint: "gear text + coin purse" },
  { key: "personality", label: "Personality", hint: "traits / ideals / bonds / flaws" },
  { key: "proficienciesLanguages", label: "Proficiencies & languages", hint: "the freeform list" },
];

/** A live-computed value chip: green number, or a red flag when the formula
 *  fails to evaluate against the sample character. */
function Preview({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-[11px] rounded-full border border-blood/50 text-blood px-2 py-0.5 whitespace-nowrap">broken</span>
  ) : (
    <span className="text-[11px] rounded-full border border-green-600/40 text-green-400/90 px-2 py-0.5 whitespace-nowrap">= {value}</span>
  );
}

export function SheetTemplateEditor({
  templateId,
  initialName,
  initialDef,
  saveAction,
  serverIssues,
}: {
  templateId: string;
  initialName: string;
  initialDef: SheetTemplateDef;
  saveAction: (formData: FormData) => void;
  /** Validation issues from a refused save (round-tripped via the page). */
  serverIssues: TemplateIssue[];
}) {
  const [name, setName] = useState(initialName);
  const [def, setDef] = useState<SheetTemplateDef>(initialDef);

  // The live wind tunnel: sanitize the working state exactly the way the
  // server will, build the sample character, resolve everything.
  const live = useMemo(() => {
    const clean = sanitizeSheetTemplate(def);
    if (!clean) return null;
    const sample = defaultSheetDataForTemplate(clean);
    // Nudge the sample off the defaults so formulas that ignore their inputs
    // are visually suspicious (everything = 0 reads broken; 12s read alive).
    for (const a of clean.abilities) (sample.abilityScores as Record<string, number>)[a.key] = 12;
    const resolver = makeSheetResolver(clean, sample);
    const issues = validateSheetTemplate(clean);
    // Sanitization silently DROPS entries with invalid/duplicate keys - a
    // half-typed key must block saving loudly, not vanish quietly.
    if (clean.abilities.length !== def.abilities.length) {
      issues.push({ where: "abilities", message: `${def.abilities.length - clean.abilities.length} would be dropped - a key is empty, invalid, or a duplicate.` });
    }
    if (clean.skills.length !== def.skills.length) {
      issues.push({ where: "skills", message: `${def.skills.length - clean.skills.length} would be dropped - a key is empty, invalid, a duplicate, or points at an unknown ability.` });
    }
    if (clean.variables.length !== def.variables.length) {
      issues.push({ where: "variables", message: `${def.variables.length - clean.variables.length} would be dropped - a key is empty, invalid, or a duplicate.` });
    }
    if (clean.coins.length !== def.coins.length) {
      issues.push({ where: "coins", message: `${def.coins.length - clean.coins.length} would be dropped - a key is empty, invalid, or a duplicate.` });
    }
    const issueSet = new Set(issues.map((i) => i.where));
    return { clean, resolver, issues, issueSet };
  }, [def]);

  const issues = live?.issues ?? [];
  const allIssues = [...serverIssues, ...issues];

  function patch(p: Partial<SheetTemplateDef>) {
    setDef((d) => ({ ...d, ...p }));
  }
  function patchFormulas(p: Partial<SheetTemplateDef["formulas"]>) {
    setDef((d) => ({ ...d, formulas: { ...d.formulas, ...p } }));
  }
  function varValue(key: string): number | null {
    if (!live) return null;
    return live.resolver.variable(key);
  }
  function formulaOk(where: string): boolean {
    return !live || !live.issueSet.has(where);
  }

  return (
    <form action={saveAction} className="space-y-6">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="definitionJson" value={JSON.stringify(def)} />

      {allIssues.length > 0 && (
        <div className="rounded-lg border border-blood/50 bg-blood/10 p-3 text-sm text-blood space-y-1">
          <div className="font-medium">This system has {allIssues.length} issue{allIssues.length === 1 ? "" : "s"} - saving is blocked until they&apos;re fixed:</div>
          {allIssues.slice(0, 8).map((i, n) => (
            <div key={n} className="text-xs">
              <span className="uppercase tracking-wider">{i.where}</span> — {i.message}
            </div>
          ))}
          {allIssues.length > 8 && <div className="text-xs">…and {allIssues.length - 8} more.</div>}
        </div>
      )}

      {/* ---------- Identity ---------- */}
      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>System name</span>
            <input className={inputCls} name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="text-xs text-parchment/45 self-end pb-1.5">
            Every number below is computed live against a sample character (all abilities at 12). If a chip reads{" "}
            <span className="text-blood">broken</span>, the formula beside it doesn&apos;t evaluate.
          </div>
        </div>
      </section>

      {/* ---------- Abilities ---------- */}
      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg text-gold">Abilities</h2>
          <button
            type="button"
            className={smallBtn}
            onClick={() => patch({ abilities: [...def.abilities, { key: `ability${def.abilities.length + 1}`, label: "New Ability", short: "NEW" }] })}
          >
            + Add Ability
          </button>
        </div>
        <p className="text-xs text-parchment/40 mb-3">
          The stat foundation. Keys are permanent identifiers (used in formulas and stored data) - rename labels freely, but changing a key
          orphans data stored under the old one.
        </p>
        <div className="space-y-2">
          {def.abilities.map((a, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <input className={`${tinyCls} w-28`} value={a.key} title="Key" placeholder="key"
                onChange={(e) => patch({ abilities: def.abilities.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)) })} />
              <input className={`${tinyCls} w-40`} value={a.label} title="Label" placeholder="Label"
                onChange={(e) => patch({ abilities: def.abilities.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
              <input className={`${tinyCls} w-16`} value={a.short} title="Short form (the carved stone)" placeholder="ABR"
                onChange={(e) => patch({ abilities: def.abilities.map((x, xi) => (xi === i ? { ...x, short: e.target.value } : x)) })} />
              <span className="text-[11px] text-parchment/40">
                mod at 12: <Preview value={live ? live.resolver.abilityMod(a.key) : null} />
              </span>
              <button type="button" className={removeBtn} onClick={() => patch({ abilities: def.abilities.filter((_, xi) => xi !== i) })}>
                remove
              </button>
            </div>
          ))}
        </div>
        <label className="block mt-4 max-w-md">
          <span className={labelCls}>Ability modifier formula (local: score)</span>
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} font-mono ${formulaOk("formula abilityMod") ? "" : "border-blood/60"}`}
              value={def.formulas.abilityMod}
              onChange={(e) => patchFormulas({ abilityMod: e.target.value })}
            />
          </div>
        </label>
      </section>

      {/* ---------- Skills ---------- */}
      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg text-gold">Skills</h2>
          <span className="inline-flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-parchment/70">
              <input type="checkbox" className="accent-gold" checked={def.expertise} onChange={(e) => patch({ expertise: e.target.checked })} />
              Expertise tier (double proficiency pips)
            </label>
            <button
              type="button"
              className={smallBtn}
              onClick={() => patch({ skills: [...def.skills, { key: `skill${def.skills.length + 1}`, label: "New Skill", ability: def.abilities[0]?.key ?? "" }] })}
            >
              + Add Skill
            </button>
          </span>
        </div>
        <p className="text-xs text-parchment/40 mb-3">Each skill derives from one ability through the bonus formula below.</p>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
          {def.skills.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${tinyCls} w-28`} value={s.key} title="Key" placeholder="key"
                onChange={(e) => patch({ skills: def.skills.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)) })} />
              <input className={`${tinyCls} flex-1 min-w-0`} value={s.label} title="Label" placeholder="Label"
                onChange={(e) => patch({ skills: def.skills.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
              <select className={tinyCls} value={s.ability} title="Derives from"
                onChange={(e) => patch({ skills: def.skills.map((x, xi) => (xi === i ? { ...x, ability: e.target.value } : x)) })}>
                {def.abilities.map((a) => (
                  <option key={a.key} value={a.key}>{a.key}</option>
                ))}
              </select>
              <Preview value={live && def.abilities.some((a) => a.key === s.ability) ? live.resolver.skillBonus(s.key) : null} />
              <button type="button" className={removeBtn} onClick={() => patch({ skills: def.skills.filter((_, xi) => xi !== i) })}>
                ×
              </button>
            </div>
          ))}
          {def.skills.length === 0 && <p className="text-xs text-parchment/40">No skills - the sheet simply won&apos;t show a skills panel.</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <label className="block">
            <span className={labelCls}>Skill bonus formula (locals: abilityMod, prof, profRank)</span>
            <input
              className={`${inputCls} font-mono ${formulaOk("formula skillBonus") ? "" : "border-blood/60"}`}
              value={def.formulas.skillBonus}
              onChange={(e) => patchFormulas({ skillBonus: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Saving throw formula (locals: abilityMod, prof, profRank)</span>
            <input
              className={`${inputCls} font-mono ${formulaOk("formula saveBonus") ? "" : "border-blood/60"}`}
              value={def.formulas.saveBonus}
              onChange={(e) => patchFormulas({ saveBonus: e.target.value })}
            />
          </label>
        </div>
      </section>

      {/* ---------- Roll variables ---------- */}
      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg text-gold">Roll Variables</h2>
          <span className="inline-flex gap-2">
            <button type="button" className={smallBtn}
              onClick={() => patch({ variables: [...def.variables, { key: `var${def.variables.length + 1}`, label: "New variable", group: "Other", path: "proficiencyBonus" }] })}>
              + From sheet field
            </button>
            <button type="button" className={smallBtn}
              onClick={() => patch({ variables: [...def.variables, { key: `var${def.variables.length + 1}`, label: "New variable", group: "Other", formula: "1 + 1" }] })}>
              + Computed
            </button>
          </span>
        </div>
        <p className="text-xs text-parchment/40 mb-3">
          Everything a roll expression may reference - the dropdown players see in the Action Creator, and what Discord custom-command
          rolls resolve. A variable either reads a sheet field by path, or computes from other variables.
        </p>
        <div className="space-y-2">
          {def.variables.map((v, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <input className={`${tinyCls} w-28`} value={v.key} title="Key (referenced in formulas & rolls)" placeholder="key"
                onChange={(e) => patch({ variables: def.variables.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)) })} />
              <input className={`${tinyCls} w-44`} value={v.label} title="Label shown in pickers" placeholder="Label"
                onChange={(e) => patch({ variables: def.variables.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
              <input className={`${tinyCls} w-28`} value={v.group} title="Picker group" placeholder="Group"
                onChange={(e) => patch({ variables: def.variables.map((x, xi) => (xi === i ? { ...x, group: e.target.value } : x)) })} />
              {v.path !== undefined ? (
                <span className="inline-flex items-center gap-1 flex-1 min-w-48">
                  <span className="text-[10px] uppercase tracking-wider text-parchment/40">path</span>
                  <input className={`${tinyCls} flex-1 min-w-0 font-mono`} value={v.path} title="Dot path into the sheet data"
                    onChange={(e) => patch({ variables: def.variables.map((x, xi) => (xi === i ? { key: x.key, label: x.label, group: x.group, path: e.target.value } : x)) })} />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 flex-1 min-w-48">
                  <span className="text-[10px] uppercase tracking-wider text-parchment/40">=</span>
                  <input className={`${tinyCls} flex-1 min-w-0 font-mono`} value={v.formula ?? ""} title="Formula over other variables"
                    onChange={(e) => patch({ variables: def.variables.map((x, xi) => (xi === i ? { key: x.key, label: x.label, group: x.group, formula: e.target.value } : x)) })} />
                </span>
              )}
              <Preview value={varValue(v.key)} />
              <button type="button" className={removeBtn} onClick={() => patch({ variables: def.variables.filter((_, xi) => xi !== i) })}>
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Derived numbers & sections ---------- */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5 space-y-4">
          <h2 className="font-display text-lg text-gold">Derived Numbers</h2>
          <label className="block">
            <span className={labelCls}>Initiative</span>
            <div className="flex items-center gap-2">
              <input className={`${inputCls} font-mono ${formulaOk("formula initiative") ? "" : "border-blood/60"}`}
                value={def.formulas.initiative} onChange={(e) => patchFormulas({ initiative: e.target.value })} />
            </div>
          </label>
          {def.features.spellcasting && (
            <>
              <label className="block">
                <span className={labelCls}>Spell save DC</span>
                <input className={`${inputCls} font-mono ${formulaOk("formula spellSaveDc") ? "" : "border-blood/60"}`}
                  value={def.formulas.spellSaveDc} onChange={(e) => patchFormulas({ spellSaveDc: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Spell attack bonus</span>
                <input className={`${inputCls} font-mono ${formulaOk("formula spellAttack") ? "" : "border-blood/60"}`}
                  value={def.formulas.spellAttack} onChange={(e) => patchFormulas({ spellAttack: e.target.value })} />
              </label>
              <label className="block max-w-40">
                <span className={labelCls}>Spell slot levels (0-9)</span>
                <input type="number" min={0} max={9} className={inputCls} value={def.spellSlotLevels}
                  onChange={(e) => patch({ spellSlotLevels: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })} />
              </label>
            </>
          )}
          <div>
            <div className="flex items-center justify-between">
              <span className={labelCls}>Passive senses</span>
              <button type="button" className={smallBtn}
                onClick={() => patchFormulas({ passives: [...def.formulas.passives, { label: "New Passive", formula: def.skills[0] ? `10 + skill("${def.skills[0].key}")` : "10" }] })}>
                + Add
              </button>
            </div>
            <div className="space-y-2 mt-2">
              {def.formulas.passives.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${tinyCls} w-40`} value={p.label}
                    onChange={(e) => patchFormulas({ passives: def.formulas.passives.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
                  <input className={`${tinyCls} flex-1 min-w-0 font-mono ${formulaOk(`passive ${p.label}`) ? "" : "border-blood/60"}`} value={p.formula}
                    onChange={(e) => patchFormulas({ passives: def.formulas.passives.map((x, xi) => (xi === i ? { ...x, formula: e.target.value } : x)) })} />
                  <button type="button" className={removeBtn} onClick={() => patchFormulas({ passives: def.formulas.passives.filter((_, xi) => xi !== i) })}>
                    ×
                  </button>
                </div>
              ))}
              {def.formulas.passives.length === 0 && <p className="text-xs text-parchment/40">None - the proficiency card shows nothing extra.</p>}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className={labelCls}>Currency denominations</span>
              <button type="button" className={smallBtn}
                onClick={() => patch({ coins: [...def.coins, { key: `c${def.coins.length + 1}`, label: "New Coin" }] })}>
                + Add
              </button>
            </div>
            <div className="space-y-2 mt-2">
              {def.coins.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${tinyCls} w-20`} value={c.key} title="Key (shown on the purse)"
                    onChange={(e) => patch({ coins: def.coins.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)) })} />
                  <input className={`${tinyCls} flex-1 min-w-0`} value={c.label} title="Full name"
                    onChange={(e) => patch({ coins: def.coins.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })} />
                  <button type="button" className={removeBtn} onClick={() => patch({ coins: def.coins.filter((_, xi) => xi !== i) })}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-1">Sheet Sections</h2>
          <p className="text-xs text-parchment/40 mb-3">What this system&apos;s sheet actually shows - switch off what your world doesn&apos;t use.</p>
          <div className="space-y-2">
            {FEATURE_LABELS.map((f) => (
              <label key={f.key} className="flex items-center gap-3 text-sm text-parchment/75">
                <input
                  type="checkbox"
                  className="accent-gold"
                  checked={def.features[f.key]}
                  onChange={(e) => patch({ features: { ...def.features, [f.key]: e.target.checked } })}
                />
                <span className="w-52">{f.label}</span>
                <span className="text-[11px] text-parchment/35">{f.hint}</span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={allIssues.length > 0 || !live}
          className={`rounded-full px-6 py-2.5 text-sm font-medium ${allIssues.length > 0 || !live ? "bg-void border border-gold/20 text-parchment/30 cursor-not-allowed" : "bg-gold/90 text-ink hover:bg-gold"}`}
        >
          Save Sheet System
        </button>
        {allIssues.length === 0 && live && (
          <span className="text-xs text-green-400/80">All formulas evaluate cleanly against the sample character.</span>
        )}
      </div>
    </form>
  );
}
