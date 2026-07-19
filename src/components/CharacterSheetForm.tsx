"use client";

import { useEffect, useState } from "react";
import { RollButton } from "./RollButton";
import { SHEET_VARIABLES, newActionRoll, newWeaponRolls, describeActionRoll } from "@/lib/character-sheet-shared";
import type { AbilityKey, ActionRoll, AttackEntry, CharacterSheetData, RollPart, SkillKey, SpellEntry } from "@/lib/types";
import { SKILL_ABILITY, SKILL_LABELS, abilityModifier, formatModifier } from "@/lib/character-sheet-shared";

const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: "str", label: "Strength" },
  { key: "dex", label: "Dexterity" },
  { key: "con", label: "Constitution" },
  { key: "int", label: "Intelligence" },
  { key: "wis", label: "Wisdom" },
  { key: "cha", label: "Charisma" },
];

const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70";
const labelCls = "block text-xs uppercase tracking-widest text-ember/80 mb-1";

export function CharacterSheetForm({
  characterName,
  initialData,
  saveAction,
  rollAction,
  saved = false,
}: {
  characterName: string;
  initialData: CharacterSheetData;
  saveAction: (formData: FormData) => void;
  /** When present, every ability and skill gets a d20 button that fires the
   *  roll on the campaign's linked Discord server - exactly what a
   *  [[mask]]: *roll x* message does (roll bridge, 2026-07-16). */
  rollAction?: (target: string) => Promise<{ ok: boolean; error?: string }>;
  /** True when the page was just reached via a successful save redirect
   *  (?saved=1) - shows the confirmation toast, then cleans the URL. */
  saved?: boolean;
}) {
  const [sheet, setSheet] = useState<CharacterSheetData>(initialData);
  // Save-confirmation toast (2026-07-19): visible for a few seconds after a
  // successful save; the ?saved=1 marker is stripped from the URL so a
  // refresh doesn't re-celebrate.
  const [showSaved, setShowSaved] = useState(saved);
  useEffect(() => {
    if (!showSaved) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(null, "", url.toString());
    }
    const t = setTimeout(() => setShowSaved(false), 3500);
    return () => clearTimeout(t);
  }, [showSaved]);
  // Action list vs. editor (2026-07-19): saved spells AND weapons show as
  // compact rows; only the entry being edited expands into the full builder.
  // (The set holds uuids from either section - they can't collide.)
  const [expandedSpells, setExpandedSpells] = useState<Set<string>>(new Set());
  function toggleSpellExpanded(id: string, open: boolean) {
    setExpandedSpells((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function updateAbility(key: AbilityKey, value: number) {
    setSheet((s) => ({ ...s, abilityScores: { ...s.abilityScores, [key]: value } }));
  }
  function updateSavingThrow(key: AbilityKey, checked: boolean) {
    setSheet((s) => ({ ...s, savingThrows: { ...s.savingThrows, [key]: checked } }));
  }
  function updateSkill(key: SkillKey, field: "proficient" | "expertise", checked: boolean) {
    setSheet((s) => ({ ...s, skills: { ...s.skills, [key]: { ...s.skills[key], [field]: checked } } }));
  }
  function updateCurrency(key: keyof CharacterSheetData["currency"], value: number) {
    setSheet((s) => ({ ...s, currency: { ...s.currency, [key]: value } }));
  }
  function updateSpellSlot(level: string, field: "total" | "used", value: number) {
    setSheet((s) => ({ ...s, spellSlots: { ...s.spellSlots, [level]: { ...s.spellSlots[level], [field]: value } } }));
  }
  function addAttack() {
    const id = crypto.randomUUID();
    // Fresh weapons come pre-armed with 5e-shaped To Hit + Damage rolls -
    // every part editable (see newWeaponRolls).
    setSheet((s) => ({
      ...s,
      attacks: [...s.attacks, { id, name: "", description: "", rolls: newWeaponRolls() }],
    }));
    toggleSpellExpanded(id, true);
  }
  function updateAttack(index: number, field: keyof AttackEntry, value: string | ActionRoll[]) {
    setSheet((s) => ({ ...s, attacks: s.attacks.map((a, i) => (i === index ? { ...a, [field]: value } : a)) }));
  }
  function addAttackRoll(attackIndex: number) {
    const atk = sheet.attacks[attackIndex];
    const label = atk.rolls.length === 0 ? "To Hit" : atk.rolls.length === 1 ? "Damage" : `Roll ${atk.rolls.length + 1}`;
    updateAttack(attackIndex, "rolls", [...atk.rolls, newActionRoll(label)]);
  }
  function updateAttackRoll(attackIndex: number, rollIndex: number, patch: Partial<ActionRoll>) {
    const atk = sheet.attacks[attackIndex];
    updateAttack(attackIndex, "rolls", atk.rolls.map((r, i) => (i === rollIndex ? { ...r, ...patch } : r)));
  }
  function removeAttackRoll(attackIndex: number, rollIndex: number) {
    const atk = sheet.attacks[attackIndex];
    updateAttack(attackIndex, "rolls", atk.rolls.filter((_, i) => i !== rollIndex));
  }
  function removeAttack(index: number) {
    setSheet((s) => ({ ...s, attacks: s.attacks.filter((_, i) => i !== index) }));
  }
  function addSpell() {
    const id = crypto.randomUUID();
    setSheet((s) => ({
      ...s,
      spells: [...s.spells, { id, level: 0, name: "", prepared: false, description: "", rolls: [] }],
    }));
    toggleSpellExpanded(id, true);
  }
  function updateSpell(index: number, field: keyof SpellEntry, value: string | number | boolean | ActionRoll[]) {
    setSheet((s) => ({ ...s, spells: s.spells.map((sp, i) => (i === index ? { ...sp, [field]: value } : sp)) }));
  }
  function addSpellRoll(spellIndex: number) {
    const spell = sheet.spells[spellIndex];
    const label = spell.rolls.length === 0 ? "To Hit" : spell.rolls.length === 1 ? "Damage" : `Roll ${spell.rolls.length + 1}`;
    updateSpell(spellIndex, "rolls", [...spell.rolls, newActionRoll(label)]);
  }
  function updateSpellRoll(spellIndex: number, rollIndex: number, patch: Partial<ActionRoll>) {
    const spell = sheet.spells[spellIndex];
    updateSpell(
      spellIndex,
      "rolls",
      spell.rolls.map((r, i) => (i === rollIndex ? { ...r, ...patch } : r))
    );
  }
  function removeSpellRoll(spellIndex: number, rollIndex: number) {
    const spell = sheet.spells[spellIndex];
    updateSpell(spellIndex, "rolls", spell.rolls.filter((_, i) => i !== rollIndex));
  }
  function removeSpell(index: number) {
    setSheet((s) => ({ ...s, spells: s.spells.filter((_, i) => i !== index) }));
  }

  const profBonus = Number(sheet.proficiencyBonus) || 0;
  const spellMod = sheet.spellcastingAbility ? abilityModifier(sheet.abilityScores[sheet.spellcastingAbility]) : 0;
  const spellSaveDc = sheet.spellcastingAbility ? 8 + profBonus + spellMod : 0;
  const spellAttackBonus = sheet.spellcastingAbility ? profBonus + spellMod : 0;
  const perceptionSkill = sheet.skills.perception;
  const passivePerception =
    10 +
    abilityModifier(sheet.abilityScores.wis) +
    (perceptionSkill.proficient ? profBonus : 0) +
    (perceptionSkill.expertise ? profBonus : 0);
  const dexMod = abilityModifier(sheet.abilityScores.dex);
  const initiativeTotal = dexMod + (Number(sheet.initiativeMisc) || 0);

  return (
    <form action={saveAction} className="space-y-8">
      <input type="hidden" name="sheetData" value={JSON.stringify(sheet)} />

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <h2 className="font-display text-xl text-gold mb-4">{characterName}</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="block">
            <span className={labelCls}>Player Name</span>
            <input className={inputCls} value={sheet.playerName} onChange={(e) => setSheet((s) => ({ ...s, playerName: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Class &amp; Level</span>
            <input className={inputCls} value={sheet.classLevel} onChange={(e) => setSheet((s) => ({ ...s, classLevel: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Background</span>
            <input className={inputCls} value={sheet.background} onChange={(e) => setSheet((s) => ({ ...s, background: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Race</span>
            <input className={inputCls} value={sheet.race} onChange={(e) => setSheet((s) => ({ ...s, race: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Alignment</span>
            <input className={inputCls} value={sheet.alignment} onChange={(e) => setSheet((s) => ({ ...s, alignment: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Experience Points</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.experiencePoints}
              onChange={(e) => setSheet((s) => ({ ...s, experiencePoints: Number(e.target.value) || 0 }))}
            />
          </label>
        </div>
      </section>

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <h2 className="font-display text-lg text-gold mb-4">Ability Scores</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {ABILITIES.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-gold/15 p-3 text-center">
              <div className="text-xs uppercase tracking-widest text-ember/80 mb-1">{label}</div>
              <input
                type="number"
                className="w-full text-center rounded-lg bg-void border border-gold/30 px-2 py-1 text-parchment mb-1"
                value={sheet.abilityScores[key]}
                onChange={(e) => updateAbility(key, Number(e.target.value) || 0)}
              />
              <div className="text-gold text-sm">{formatModifier(abilityModifier(sheet.abilityScores[key]))}</div>
              {rollAction && <RollButton target={key} label={label} rollAction={rollAction} className="mx-auto mt-1" />}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-6 mt-4">
          <label className="flex items-center gap-2 text-sm text-parchment/70">
            <input
              type="checkbox"
              className="accent-gold"
              checked={sheet.inspiration}
              onChange={(e) => setSheet((s) => ({ ...s, inspiration: e.target.checked }))}
            />
            Inspiration
          </label>
          <label className="flex items-center gap-2 text-sm text-parchment/70">
            Proficiency Bonus
            <input
              type="number"
              className="w-16 rounded-lg bg-void border border-gold/30 px-2 py-1 text-parchment"
              value={sheet.proficiencyBonus}
              onChange={(e) => setSheet((s) => ({ ...s, proficiencyBonus: Number(e.target.value) || 0 }))}
            />
          </label>
          <div className="text-sm text-parchment/70">Passive Perception: <span className="text-gold">{passivePerception}</span></div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-4">Saving Throws</h2>
          <div className="space-y-2">
            {ABILITIES.map(({ key, label }) => {
              const proficient = sheet.savingThrows[key];
              const bonus = abilityModifier(sheet.abilityScores[key]) + (proficient ? profBonus : 0);
              return (
                <label key={key} className="flex items-center gap-3 text-sm text-parchment/80">
                  <input type="checkbox" className="accent-gold" checked={proficient} onChange={(e) => updateSavingThrow(key, e.target.checked)} />
                  <span className="w-10 text-gold">{formatModifier(bonus)}</span>
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-4">Skills</h2>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-2">
            {(Object.keys(SKILL_LABELS) as SkillKey[]).map((key) => {
              const ability = SKILL_ABILITY[key];
              const entry = sheet.skills[key];
              const bonus = abilityModifier(sheet.abilityScores[ability]) + (entry.proficient ? profBonus : 0) + (entry.expertise ? profBonus : 0);
              return (
                <div key={key} className="flex items-center gap-2 text-sm text-parchment/80">
                  <input
                    type="checkbox"
                    title="Proficient"
                    className="accent-gold"
                    checked={entry.proficient}
                    onChange={(e) => updateSkill(key, "proficient", e.target.checked)}
                  />
                  <input
                    type="checkbox"
                    title="Expertise"
                    className="accent-ember"
                    checked={entry.expertise}
                    onChange={(e) => updateSkill(key, "expertise", e.target.checked)}
                  />
                  <span className="w-10 text-gold">{formatModifier(bonus)}</span>
                  <span className="flex-1">{SKILL_LABELS[key]}</span>
                  {rollAction && <RollButton target={key} label={SKILL_LABELS[key]} rollAction={rollAction} />}
                  <span className="text-xs text-parchment/40 uppercase">{ability}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <h2 className="font-display text-lg text-gold mb-4">Combat</h2>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <label className="block">
            <span className={labelCls}>Armor Class</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.armorClass}
              onChange={(e) => setSheet((s) => ({ ...s, armorClass: Number(e.target.value) || 0 }))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Initiative Misc.</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.initiativeMisc}
              onChange={(e) => setSheet((s) => ({ ...s, initiativeMisc: Number(e.target.value) || 0 }))}
            />
          </label>
          <div className="block">
            <span className={labelCls}>Initiative Total</span>
            <div className="rounded-lg border border-gold/15 px-3 py-2 text-gold">{formatModifier(initiativeTotal)}</div>
          </div>
          <label className="block">
            <span className={labelCls}>Speed</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.speed}
              onChange={(e) => setSheet((s) => ({ ...s, speed: Number(e.target.value) || 0 }))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Hit Dice Total</span>
            <input className={inputCls} value={sheet.hitDiceTotal} onChange={(e) => setSheet((s) => ({ ...s, hitDiceTotal: e.target.value }))} placeholder="e.g. 5d10" />
          </label>
          <label className="block">
            <span className={labelCls}>Hit Dice Current</span>
            <input className={inputCls} value={sheet.hitDiceCurrent} onChange={(e) => setSheet((s) => ({ ...s, hitDiceCurrent: e.target.value }))} placeholder="e.g. 3d10" />
          </label>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <label className="block">
            <span className={labelCls}>Hit Point Maximum</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.hitPointMax}
              onChange={(e) => setSheet((s) => ({ ...s, hitPointMax: Number(e.target.value) || 0 }))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Current Hit Points</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.hitPointCurrent}
              onChange={(e) => setSheet((s) => ({ ...s, hitPointCurrent: Number(e.target.value) || 0 }))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Temporary Hit Points</span>
            <input
              type="number"
              className={inputCls}
              value={sheet.hitPointTemp}
              onChange={(e) => setSheet((s) => ({ ...s, hitPointTemp: Number(e.target.value) || 0 }))}
            />
          </label>
        </div>
        <div className="mt-4">
          <span className={labelCls}>Death Saves</span>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2 text-sm text-parchment/70">
              Successes
              {[1, 2, 3].map((n) => (
                <input
                  key={n}
                  type="checkbox"
                  className="accent-gold"
                  checked={sheet.deathSaveSuccesses >= n}
                  onChange={() => setSheet((s) => ({ ...s, deathSaveSuccesses: s.deathSaveSuccesses >= n ? n - 1 : n }))}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm text-parchment/70">
              Failures
              {[1, 2, 3].map((n) => (
                <input
                  key={n}
                  type="checkbox"
                  className="accent-blood"
                  checked={sheet.deathSaveFailures >= n}
                  onChange={() => setSheet((s) => ({ ...s, deathSaveFailures: s.deathSaveFailures >= n ? n - 1 : n }))}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-gold">Attacks &amp; Cantrips</h2>
          <button type="button" onClick={addAttack} className="text-xs rounded-full border border-gold/40 text-gold px-3 py-1 hover:bg-gold/10">
            + Add
          </button>
        </div>
        <div className="space-y-2">
          {sheet.attacks.map((atk, i) => (
            !expandedSpells.has(atk.id) ? (
              <div key={atk.id} className="flex items-center gap-3 rounded-lg border border-gold/15 bg-void/40 px-3 py-2">
                <span className="flex-1 text-sm text-parchment truncate">
                  {atk.name || <span className="text-parchment/40 italic">Unnamed weapon</span>}
                </span>
                <span className="hidden sm:block text-xs text-parchment/45 truncate max-w-64">
                  {atk.rolls.length > 0
                    ? atk.rolls.map((r) => `${r.label} ${describeActionRoll(r)}`).join(" · ")
                    : "no rolls"}
                </span>
                {rollAction && atk.rolls.length > 0 && (
                  <RollButton target={`attack:${atk.id}`} label={atk.name || "this weapon"} rollAction={rollAction} />
                )}
                <button type="button" onClick={() => toggleSpellExpanded(atk.id, true)} className="text-xs text-gold/80 hover:text-gold hover:underline">
                  Edit
                </button>
              </div>
            ) : (
            <div key={atk.id} className="rounded-lg border border-gold/40 bg-void/40 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <input className={inputCls} placeholder="Weapon name" value={atk.name} onChange={(e) => updateAttack(i, "name", e.target.value)} />
                {rollAction && atk.rolls.length > 0 && (
                  <RollButton target={`attack:${atk.id}`} label={atk.name || "this weapon"} rollAction={rollAction} />
                )}
                <button type="button" onClick={() => removeAttack(i)} className="text-blood text-xs hover:underline">
                  Remove
                </button>
              </div>
              <textarea
                className={`${inputCls} w-full`}
                rows={2}
                placeholder="Properties, range, weight, cost, flavor... (e.g. Martial melee · Versatile (1d10) · 3 lb · 15 gp)"
                value={atk.description}
                onChange={(e) => updateAttack(i, "description", e.target.value)}
              />
              <div className="space-y-1.5">
                {atk.rolls.map((roll, ri) => (
                  <ActionRollEditor
                    key={roll.id}
                    roll={roll}
                    onChange={(patch) => updateAttackRoll(i, ri, patch)}
                    onRemove={() => removeAttackRoll(i, ri)}
                  />
                ))}
                <button type="button" onClick={() => addAttackRoll(i)} className="text-xs text-gold/80 hover:text-gold hover:underline">
                  + Add Roll
                </button>
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => toggleSpellExpanded(atk.id, false)}
                  className="rounded-full border border-gold/40 text-gold px-4 py-1 text-xs hover:bg-gold/10"
                >
                  Done
                </button>
              </div>
            </div>
            )
          ))}
          {sheet.attacks.length === 0 && <div className="text-xs text-parchment/40">No attacks added yet.</div>}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-4">Equipment</h2>
          <textarea
            rows={6}
            className={inputCls}
            value={sheet.equipment}
            onChange={(e) => setSheet((s) => ({ ...s, equipment: e.target.value }))}
          />
          <div className="grid grid-cols-5 gap-2 mt-4">
            {(["cp", "sp", "ep", "gp", "pp"] as const).map((c) => (
              <label key={c} className="block text-center">
                <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{c}</span>
                <input
                  type="number"
                  className="w-full text-center rounded-lg bg-void border border-gold/30 px-2 py-1 text-parchment"
                  value={sheet.currency[c]}
                  onChange={(e) => updateCurrency(c, Number(e.target.value) || 0)}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-4">Proficiencies, Languages &amp; Features</h2>
          <label className="block mb-4">
            <span className={labelCls}>Other Proficiencies &amp; Languages</span>
            <textarea
              rows={3}
              className={inputCls}
              value={sheet.proficienciesLanguages}
              onChange={(e) => setSheet((s) => ({ ...s, proficienciesLanguages: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Features &amp; Traits</span>
            <textarea
              rows={4}
              className={inputCls}
              value={sheet.featuresTraits}
              onChange={(e) => setSheet((s) => ({ ...s, featuresTraits: e.target.value }))}
            />
          </label>
        </section>
      </div>

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <h2 className="font-display text-lg text-gold mb-4">Personality</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Personality Traits</span>
            <textarea rows={3} className={inputCls} value={sheet.personalityTraits} onChange={(e) => setSheet((s) => ({ ...s, personalityTraits: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Ideals</span>
            <textarea rows={3} className={inputCls} value={sheet.ideals} onChange={(e) => setSheet((s) => ({ ...s, ideals: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Bonds</span>
            <textarea rows={3} className={inputCls} value={sheet.bonds} onChange={(e) => setSheet((s) => ({ ...s, bonds: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Flaws</span>
            <textarea rows={3} className={inputCls} value={sheet.flaws} onChange={(e) => setSheet((s) => ({ ...s, flaws: e.target.value }))} />
          </label>
        </div>
      </section>

      <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
        <h2 className="font-display text-lg text-gold mb-4">Spellcasting</h2>
        <div className="grid sm:grid-cols-4 gap-4 mb-4">
          <label className="block">
            <span className={labelCls}>Spellcasting Class</span>
            <input className={inputCls} value={sheet.spellcastingClass} onChange={(e) => setSheet((s) => ({ ...s, spellcastingClass: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Spellcasting Ability</span>
            <select
              className={inputCls}
              value={sheet.spellcastingAbility}
              onChange={(e) => setSheet((s) => ({ ...s, spellcastingAbility: e.target.value as AbilityKey | "" }))}
            >
              <option value="">&mdash;</option>
              {ABILITIES.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="block">
            <span className={labelCls}>Spell Save DC</span>
            <div className="rounded-lg border border-gold/15 px-3 py-2 text-gold">{spellSaveDc}</div>
          </div>
          <div className="block">
            <span className={labelCls}>Spell Attack Bonus</span>
            <div className="rounded-lg border border-gold/15 px-3 py-2 text-gold">{formatModifier(spellAttackBonus)}</div>
          </div>
        </div>

        <div className="mb-4">
          <span className={labelCls}>Spell Slots</span>
          <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
            {Array.from({ length: 9 }, (_, i) => String(i + 1)).map((lvl) => (
              <div key={lvl} className="rounded-lg border border-gold/15 p-2 text-center">
                <div className="text-xs text-ember/80 mb-1">Lvl {lvl}</div>
                <input
                  type="number"
                  className="w-full text-center rounded bg-void border border-gold/30 px-1 py-1 text-parchment text-xs mb-1"
                  value={sheet.spellSlots[lvl]?.total ?? 0}
                  onChange={(e) => updateSpellSlot(lvl, "total", Number(e.target.value) || 0)}
                  title="Total"
                />
                <input
                  type="number"
                  className="w-full text-center rounded bg-void border border-gold/20 px-1 py-1 text-parchment/60 text-xs"
                  value={sheet.spellSlots[lvl]?.used ?? 0}
                  onChange={(e) => updateSpellSlot(lvl, "used", Number(e.target.value) || 0)}
                  title="Used"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className={labelCls}>Spells</span>
          <button type="button" onClick={addSpell} className="text-xs rounded-full border border-gold/40 text-gold px-3 py-1 hover:bg-gold/10">
            + Add
          </button>
        </div>
        <div className="space-y-2">
          {sheet.spells.map((sp, i) => (
            !expandedSpells.has(sp.id) ? (
              <div key={sp.id} className="flex items-center gap-3 rounded-lg border border-gold/15 bg-void/40 px-3 py-2">
                <span className="shrink-0 rounded-full border border-gold/30 text-gold text-[10px] px-2 py-0.5 uppercase tracking-wider">
                  {sp.level > 0 ? `Lv ${sp.level}` : "Cantrip"}
                </span>
                <span className="flex-1 text-sm text-parchment truncate">
                  {sp.name || <span className="text-parchment/40 italic">Unnamed spell</span>}
                  {sp.prepared && <span className="ml-2 text-[10px] text-gold/70 uppercase tracking-wider">prepared</span>}
                </span>
                <span className="hidden sm:block text-xs text-parchment/45 truncate max-w-64">
                  {sp.rolls.length > 0
                    ? sp.rolls.map((r) => `${r.label} ${describeActionRoll(r)}`).join(" · ")
                    : "no rolls"}
                </span>
                {rollAction && sp.rolls.length > 0 && (
                  <RollButton target={`spell:${sp.id}`} label={sp.name || "this spell"} rollAction={rollAction} />
                )}
                <button type="button" onClick={() => toggleSpellExpanded(sp.id, true)} className="text-xs text-gold/80 hover:text-gold hover:underline">
                  Edit
                </button>
              </div>
            ) : (
            <div key={sp.id} className="rounded-lg border border-gold/40 bg-void/40 p-3 space-y-2">
              <div className="grid grid-cols-[4rem_1fr_auto_auto_auto] gap-2 items-center">
                <input
                  type="number"
                  className={inputCls}
                  value={sp.level}
                  onChange={(e) => updateSpell(i, "level", Number(e.target.value) || 0)}
                  title="Level"
                />
                <input className={inputCls} placeholder="Spell name" value={sp.name} onChange={(e) => updateSpell(i, "name", e.target.value)} />
                <label className="flex items-center gap-1 text-xs text-parchment/70">
                  <input type="checkbox" className="accent-gold" checked={sp.prepared} onChange={(e) => updateSpell(i, "prepared", e.target.checked)} />
                  Prepared
                </label>
                {rollAction && sp.rolls.length > 0 && (
                  <RollButton target={`spell:${sp.id}`} label={sp.name || "this spell"} rollAction={rollAction} />
                )}
                <button type="button" onClick={() => removeSpell(i)} className="text-blood text-xs hover:underline">
                  Remove
                </button>
              </div>
              <textarea
                className={`${inputCls} w-full`}
                rows={2}
                placeholder="Spell description - what it does, rules text, flavor..."
                value={sp.description}
                onChange={(e) => updateSpell(i, "description", e.target.value)}
              />
              <div className="space-y-1.5">
                {sp.rolls.map((roll, ri) => (
                  <ActionRollEditor
                    key={roll.id}
                    roll={roll}
                    onChange={(patch) => updateSpellRoll(i, ri, patch)}
                    onRemove={() => removeSpellRoll(i, ri)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => addSpellRoll(i)}
                  className="text-xs text-gold/80 hover:text-gold hover:underline"
                >
                  + Add Roll
                </button>
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => toggleSpellExpanded(sp.id, false)}
                  className="rounded-full border border-gold/40 text-gold px-4 py-1 text-xs hover:bg-gold/10"
                >
                  Done
                </button>
              </div>
            </div>
            )
          ))}
          {sheet.spells.length === 0 && <div className="text-xs text-parchment/40">No spells added yet.</div>}
        </div>
      </section>

      <div>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold">
          Save Character Sheet
        </button>
      </div>

      {showSaved && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-gold/60 bg-void px-5 py-3 shadow-card text-sm text-gold">
          <span aria-hidden>✓</span> Character sheet saved
        </div>
      )}
    </form>
  );
}

// One slot of a roll expression (Action Creator v1): a compact picker that
// is either a literal number input or a sheet-variable dropdown. Selecting
// "123" flips back to number mode; anything else is a variable key from
// SHEET_VARIABLES (see character-sheet-shared.ts - the keys are a stable
// contract with the Discord bot's resolver).
// One full roll expression row (Action Creator, 2026-07-20): label, count d
// die, then ANY number of additive modifier terms - a longsword To Hit is
// 1d20 + [strMod] + [prof]. Shared by the spell and weapon editors.
function ActionRollEditor({
  roll,
  onChange,
  onRemove,
}: {
  roll: ActionRoll;
  onChange: (patch: Partial<ActionRoll>) => void;
  onRemove: () => void;
}) {
  const mods = roll.modifiers ?? [];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <input
        className="w-24 rounded bg-void border border-gold/30 px-1.5 py-1 text-parchment text-xs"
        placeholder="Label"
        value={roll.label}
        onChange={(e) => onChange({ label: e.target.value })}
        title="What this roll is for (To Hit, Damage...)"
      />
      <RollPartInput value={roll.count} onChange={(v) => onChange({ count: v })} title="Number of dice" />
      <span className="text-gold font-medium">d</span>
      <RollPartInput value={roll.die} onChange={(v) => onChange({ die: v })} title="Die type" />
      {mods.map((m, mi) => (
        <span key={mi} className="inline-flex items-center gap-1">
          <span className="text-gold font-medium">+</span>
          <RollPartInput
            value={m}
            onChange={(v) => onChange({ modifiers: mods.map((x, xi) => (xi === mi ? v : x)) })}
            title="Modifier term"
            allowNegative
          />
          <button
            type="button"
            onClick={() => onChange({ modifiers: mods.filter((_, xi) => xi !== mi) })}
            className="text-blood/70 hover:text-blood"
            title="Remove this modifier term"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange({ modifiers: [...mods, 0] })}
        className="text-gold/70 hover:text-gold hover:underline"
        title="Add a modifier term (number or sheet variable)"
      >
        + mod
      </button>
      <span className="text-parchment/40 ml-1">= {describeActionRoll(roll)}</span>
      <button type="button" onClick={onRemove} className="text-blood hover:underline ml-auto">
        remove roll
      </button>
    </div>
  );
}

function RollPartInput({
  value,
  onChange,
  title,
  allowNegative = false,
}: {
  value: RollPart;
  onChange: (v: RollPart) => void;
  title: string;
  allowNegative?: boolean;
}) {
  const isNumber = typeof value === "number";
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {isNumber && (
        <input
          type="number"
          min={allowNegative ? undefined : 0}
          className="w-14 rounded bg-void border border-gold/30 px-1.5 py-1 text-parchment text-xs"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      )}
      <select
        className="rounded bg-void border border-gold/30 px-1 py-1 text-parchment/80 text-xs max-w-28"
        value={isNumber ? "__number" : (value as string)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__number") onChange(isNumber ? value : 1);
          else onChange(v);
        }}
      >
        <option value="__number">123 (number)</option>
        {["Modifiers", "Ability scores", "Other"].map((group) => (
          <optgroup key={group} label={group}>
            {SHEET_VARIABLES.filter((sv) => sv.group === group).map((sv) => (
              <option key={sv.key} value={sv.key}>
                {sv.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}
