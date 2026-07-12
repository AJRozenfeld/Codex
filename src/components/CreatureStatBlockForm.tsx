"use client";

import { useState } from "react";
import type { AbilityKey, MonsterFeature, MonsterStatBlock } from "@/lib/types";
import { CREATURE_SIZES, CREATURE_TYPES, CHALLENGE_RATINGS, abilityModifier, formatModifier } from "@/lib/monster-stat-block-shared";

const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: "str", label: "STR" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIS" },
  { key: "cha", label: "CHA" },
];

const FEATURE_SECTIONS: { key: keyof Pick<MonsterStatBlock, "traits" | "actions" | "bonusActions" | "reactions" | "legendaryActions">; label: string; hint: string }[] = [
  { key: "traits", label: "Traits", hint: "Passive abilities, e.g. Pack Tactics, Keen Smell" },
  { key: "actions", label: "Actions", hint: "Attacks and other things it can do on its turn" },
  { key: "bonusActions", label: "Bonus Actions", hint: "Leave empty if this creature has none" },
  { key: "reactions", label: "Reactions", hint: "Leave empty if this creature has none" },
  { key: "legendaryActions", label: "Legendary Actions", hint: "Leave empty for non-legendary creatures" },
];

const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70";
const labelCls = "block text-xs uppercase tracking-widest text-ember/80 mb-1";

/**
 * Client-side editor for the full 5e stat block - this is "the blank
 * template" Aviv asked for: a homebrew monster and an imported SRD monster
 * both go through this exact same shape, just with different starting
 * values (defaultStatBlock() vs. an imported blob). Mirrors
 * CharacterSheetForm.tsx's pattern - local state, one hidden JSON input, the
 * server action does the actual save.
 */
export function CreatureStatBlockForm({
  initialData,
  saveAction,
  submitLabel = "Save",
}: {
  initialData: MonsterStatBlock;
  saveAction: (formData: FormData) => void;
  submitLabel?: string;
}) {
  const [sb, setSb] = useState<MonsterStatBlock>(initialData);

  function updateAbility(key: AbilityKey, value: number) {
    setSb((s) => ({ ...s, abilityScores: { ...s.abilityScores, [key]: value } }));
  }
  function update<K extends keyof MonsterStatBlock>(key: K, value: MonsterStatBlock[K]) {
    setSb((s) => ({ ...s, [key]: value }));
  }
  function addFeature(section: (typeof FEATURE_SECTIONS)[number]["key"]) {
    setSb((s) => ({ ...s, [section]: [...s[section], { name: "", text: "" }] }));
  }
  function updateFeature(section: (typeof FEATURE_SECTIONS)[number]["key"], index: number, field: keyof MonsterFeature, value: string) {
    setSb((s) => ({
      ...s,
      [section]: s[section].map((f, i) => (i === index ? { ...f, [field]: value } : f)),
    }));
  }
  function removeFeature(section: (typeof FEATURE_SECTIONS)[number]["key"], index: number) {
    setSb((s) => ({ ...s, [section]: s[section].filter((_, i) => i !== index) }));
  }

  return (
    <form action={saveAction} className="space-y-8">
      <input type="hidden" name="statBlockData" value={JSON.stringify(sb)} />

      <section className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className={labelCls}>Size</span>
          <select className={inputCls} value={sb.size} onChange={(e) => update("size", e.target.value)}>
            {CREATURE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Type</span>
          <select className={inputCls} value={sb.creatureType} onChange={(e) => update("creatureType", e.target.value)}>
            {CREATURE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Alignment</span>
          <input className={inputCls} value={sb.alignment} onChange={(e) => update("alignment", e.target.value)} placeholder="e.g. Chaotic Evil" />
        </label>
        <label className="block">
          <span className={labelCls}>Speed</span>
          <input className={inputCls} value={sb.speed} onChange={(e) => update("speed", e.target.value)} placeholder="e.g. 30 ft., fly 60 ft." />
        </label>
      </section>

      <section>
        <h3 className="font-display text-lg text-gold mb-3">Ability Scores</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {ABILITIES.map((a) => {
            const score = sb.abilityScores[a.key];
            return (
              <label key={a.key} className="block text-center rounded-lg border border-gold/15 p-2">
                <span className={labelCls}>{a.label}</span>
                <input
                  type="number"
                  className={`${inputCls} text-center`}
                  value={score}
                  onChange={(e) => updateAbility(a.key, Number(e.target.value) || 0)}
                />
                <span className="block text-xs text-parchment/50 mt-1">{formatModifier(abilityModifier(score))}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Saving Throws</span>
          <input className={inputCls} value={sb.savingThrows} onChange={(e) => update("savingThrows", e.target.value)} placeholder="e.g. Dex +4, Con +5" />
        </label>
        <label className="block">
          <span className={labelCls}>Skills</span>
          <input className={inputCls} value={sb.skills} onChange={(e) => update("skills", e.target.value)} placeholder="e.g. Perception +4, Stealth +3" />
        </label>
        <label className="block">
          <span className={labelCls}>Damage Vulnerabilities</span>
          <input className={inputCls} value={sb.damageVulnerabilities} onChange={(e) => update("damageVulnerabilities", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Damage Resistances</span>
          <input className={inputCls} value={sb.damageResistances} onChange={(e) => update("damageResistances", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Damage Immunities</span>
          <input className={inputCls} value={sb.damageImmunities} onChange={(e) => update("damageImmunities", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Condition Immunities</span>
          <input className={inputCls} value={sb.conditionImmunities} onChange={(e) => update("conditionImmunities", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Senses</span>
          <input className={inputCls} value={sb.senses} onChange={(e) => update("senses", e.target.value)} placeholder="e.g. darkvision 60 ft., passive Perception 13" />
        </label>
        <label className="block">
          <span className={labelCls}>Languages</span>
          <input className={inputCls} value={sb.languages} onChange={(e) => update("languages", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Challenge Rating</span>
          <select className={inputCls} value={sb.challengeRating} onChange={(e) => update("challengeRating", e.target.value)}>
            {CHALLENGE_RATINGS.map((cr) => (
              <option key={cr} value={cr}>{cr}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>XP</span>
          <input type="number" className={inputCls} value={sb.xp} onChange={(e) => update("xp", Number(e.target.value) || 0)} />
        </label>
      </section>

      {FEATURE_SECTIONS.map(({ key, label, hint }) => (
        <section key={key}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-lg text-gold">{label}</h3>
            <button type="button" onClick={() => addFeature(key)} className="text-xs text-gold hover:underline">+ Add</button>
          </div>
          <p className="text-xs text-parchment/40 mb-3">{hint}</p>
          <div className="space-y-3">
            {sb[key].map((f, i) => (
              <div key={i} className="rounded-lg border border-gold/15 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputCls} flex-1`}
                    value={f.name}
                    onChange={(e) => updateFeature(key, i, "name", e.target.value)}
                    placeholder="Name"
                  />
                  <button type="button" onClick={() => removeFeature(key, i)} className="text-xs text-blood/80 hover:underline whitespace-nowrap">Remove</button>
                </div>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={f.text}
                  onChange={(e) => updateFeature(key, i, "text", e.target.value)}
                  placeholder="Description"
                />
              </div>
            ))}
            {sb[key].length === 0 && <p className="text-xs text-parchment/35 px-1">None yet.</p>}
          </div>
        </section>
      ))}

      <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold">
        {submitLabel}
      </button>
    </form>
  );
}
