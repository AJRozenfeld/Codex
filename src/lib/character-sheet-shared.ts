// Pure, client-safe helpers and constants for the 5e character sheet - no
// database imports here, so this file can be pulled into the "use client"
// CharacterSheetForm without webpack trying to bundle node:fs/node:path from
// db.ts. Server-side load/save lives in character-sheet.ts, which re-exports
// everything from this module too.
//
// SHEET ENGINE PHASE A (2026-08-06): the 5e system definition itself moved
// into src/lib/sheet-engine.ts as the seeded SHEET_TEMPLATE_5E template -
// every export below that used to hardcode 5e (SKILL_ABILITY, SKILL_LABELS,
// SHEET_VARIABLES, resolveSheetVariable, abilityModifier,
// defaultCharacterSheet) is now DERIVED from that template through the
// engine. Same keys, same values, same behavior - the Phase A parity drill
// asserts equality against the pre-engine math - but there is now exactly
// one place the system lives.
import type { ActionRoll, AttackEntry, CharacterSheetData, CustomAction, RollPart, SkillKey, SpellEntry } from "./types";
import {
  SHEET_TEMPLATE_5E,
  abilityModFor,
  defaultSheetDataForTemplate,
  resolveTemplateVariable,
} from "./sheet-engine";

export const SKILL_ABILITY: Record<SkillKey, "str" | "dex" | "con" | "int" | "wis" | "cha"> =
  SHEET_TEMPLATE_5E.skills.reduce((acc, s) => {
    acc[s.key as SkillKey] = s.ability as "str" | "dex" | "con" | "int" | "wis" | "cha";
    return acc;
  }, {} as Record<SkillKey, "str" | "dex" | "con" | "int" | "wis" | "cha">);

export const SKILL_LABELS: Record<SkillKey, string> = SHEET_TEMPLATE_5E.skills.reduce((acc, s) => {
  acc[s.key as SkillKey] = s.label;
  return acc;
}, {} as Record<SkillKey, string>);

export function defaultCharacterSheet(): CharacterSheetData {
  // The 5e template's default blob has exactly the historical shape - the
  // cast is the Phase A bridge between the engine's generic records and the
  // 5e-specialized CharacterSheetData typing.
  return defaultSheetDataForTemplate(SHEET_TEMPLATE_5E) as unknown as CharacterSheetData;
}

export function mergeWithDefaults(partial: Partial<CharacterSheetData>): CharacterSheetData {
  const base = defaultCharacterSheet();
  return {
    ...base,
    ...partial,
    abilityScores: { ...base.abilityScores, ...(partial.abilityScores ?? {}) },
    savingThrows: { ...base.savingThrows, ...(partial.savingThrows ?? {}) },
    skills: { ...base.skills, ...(partial.skills ?? {}) },
    currency: { ...base.currency, ...(partial.currency ?? {}) },
    spellSlots: { ...base.spellSlots, ...(partial.spellSlots ?? {}) },
    attacks: (partial.attacks ?? base.attacks).map((atk) => normalizeAttackEntry(atk as Partial<AttackEntry>)),
    customActions: (partial.customActions ?? base.customActions).map((a) => normalizeCustomAction(a as Partial<CustomAction>)),
    spells: (partial.spells ?? base.spells).map((sp) => normalizeSpellEntry(sp as Partial<SpellEntry>)),
  };
}

export function abilityModifier(score: number): number {
  return abilityModFor(SHEET_TEMPLATE_5E, score);
}

// ---------------------------------------------------------------------------
// Sheet variables (Action Creator v1, 2026-07-19): every numerical value a
// roll expression may reference. KEYS ARE A STABLE CONTRACT - the Discord
// bot resolves the same keys in discord-bot/src/rolls.ts (resolveSheetVariable
// there); change them in both places or not at all. As of Phase A the keys
// live on SHEET_TEMPLATE_5E.variables in sheet-engine.ts - this array is a
// derived view kept for its many call sites.
// ---------------------------------------------------------------------------

export interface SheetVariable {
  key: string;
  label: string;
  group: string;
}

export const SHEET_VARIABLES: SheetVariable[] = SHEET_TEMPLATE_5E.variables.map((v) => ({
  key: v.key,
  label: v.label,
  group: v.group,
}));

/** Resolves a variable key against a sheet. Null for unknown keys - callers
 *  treat that as 0 with a warning rather than refusing to roll. Delegates to
 *  the engine against the seeded 5e template. */
export function resolveSheetVariable(sheet: CharacterSheetData, key: string): number | null {
  return resolveTemplateVariable(SHEET_TEMPLATE_5E, sheet as unknown as Record<string, unknown>, key);
}

const VARIABLE_LABELS = new Map(SHEET_VARIABLES.map((v) => [v.key, v.label]));

/** Short display for a roll part: numbers as-is, variables by key (the UI
 *  shows the friendly label in the picker; expressions stay compact). */
export function formatRollPart(part: RollPart): string {
  return typeof part === "number" ? String(part) : `[${part}]`;
}

export function describeActionRoll(roll: ActionRoll): string {
  const mods = (roll.modifiers ?? [])
    .map((m) => (typeof m === "number" ? (m === 0 ? "" : m > 0 ? `+${m}` : `${m}`) : `+[${m}]`))
    .join("");
  return `${formatRollPart(roll.count)}d${formatRollPart(roll.die)}${mods}`;
}

export function isKnownVariable(key: string): boolean {
  return VARIABLE_LABELS.has(key);
}

export function newActionRoll(label: string): ActionRoll {
  return { id: crypto.randomUUID(), label, count: 1, die: 20, modifiers: [] };
}

/** Migrates any stored roll to the current shape - notably the one-day-old
 *  single-`modifier` format (2026-07-19) into the modifiers array. */
export function normalizeActionRoll(raw: Partial<ActionRoll> & { modifier?: RollPart }): ActionRoll {
  let modifiers: RollPart[];
  if (Array.isArray(raw.modifiers)) modifiers = raw.modifiers;
  else if (raw.modifier !== undefined && raw.modifier !== 0) modifiers = [raw.modifier];
  else modifiers = [];
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    label: typeof raw.label === "string" ? raw.label : "Roll",
    count: raw.count ?? 1,
    die: raw.die ?? 20,
    modifiers,
  };
}

/** Sensible starting rolls for a fresh weapon: a 5e-flavored To Hit
 *  (1d20 + strMod + prof) and Damage (1d6 + strMod) - every part editable,
 *  so a finesse/ranged/homebrew weapon is two dropdown changes away. */
export function newWeaponRolls(): ActionRoll[] {
  return [
    { id: crypto.randomUUID(), label: "To Hit", count: 1, die: 20, modifiers: ["strMod", "prof"] },
    { id: crypto.randomUUID(), label: "Damage", count: 1, die: 6, modifiers: ["strMod"] },
  ];
}

/** Backfills pre-Action-Creator attack entries. The old shape was three
 *  free-text fields (name/atkBonus/damage); their text is preserved by
 *  folding it into the description so nothing a player wrote is lost, and
 *  the rolls start empty for a proper rebuild. */
export function newCustomAction(): CustomAction {
  return { id: crypto.randomUUID(), name: "", description: "", rolls: [] };
}

export function normalizeCustomAction(a: Partial<CustomAction> & Record<string, unknown>): CustomAction {
  return {
    id: typeof a.id === "string" && a.id ? a.id : crypto.randomUUID(),
    name: typeof a.name === "string" ? a.name : "",
    description: typeof a.description === "string" ? a.description : "",
    rolls: Array.isArray(a.rolls) ? (a.rolls as ActionRoll[]).map(normalizeActionRoll) : [],
  };
}

export function normalizeAttackEntry(atk: Partial<AttackEntry> & Record<string, unknown>): AttackEntry {
  const legacyBits: string[] = [];
  if (typeof atk.atkBonus === "string" && atk.atkBonus.trim()) legacyBits.push(`Atk ${atk.atkBonus.trim()}`);
  if (typeof atk.damage === "string" && atk.damage.trim()) legacyBits.push(`Damage ${atk.damage.trim()}`);
  const baseDescription = typeof atk.description === "string" ? atk.description : "";
  const description =
    baseDescription || (legacyBits.length ? legacyBits.join(" · ") : "");
  return {
    id: typeof atk.id === "string" && atk.id ? atk.id : crypto.randomUUID(),
    name: typeof atk.name === "string" ? atk.name : "",
    description,
    rolls: Array.isArray(atk.rolls) ? (atk.rolls as ActionRoll[]).map(normalizeActionRoll) : [],
  };
}

/** Backfills pre-Action-Creator spell entries (no id/description/rolls) so
 *  every SpellEntry in a merged sheet has the full modern shape. */
export function normalizeSpellEntry(sp: Partial<SpellEntry> & Record<string, unknown>): SpellEntry {
  return {
    id: typeof sp.id === "string" && sp.id ? sp.id : crypto.randomUUID(),
    level: typeof sp.level === "number" ? sp.level : 0,
    name: typeof sp.name === "string" ? sp.name : "",
    prepared: Boolean(sp.prepared),
    description: typeof sp.description === "string" ? sp.description : "",
    rolls: Array.isArray(sp.rolls) ? (sp.rolls as ActionRoll[]).map(normalizeActionRoll) : [],
  };
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
