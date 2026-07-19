// Pure, client-safe helpers and constants for the 5e character sheet - no
// database imports here, so this file can be pulled into the "use client"
// CharacterSheetForm without webpack trying to bundle node:fs/node:path from
// db.ts. Server-side load/save lives in character-sheet.ts, which re-exports
// everything from this module too.
import type { ActionRoll, AttackEntry, CharacterSheetData, RollPart, SkillKey, SpellEntry } from "./types";

export const SKILL_ABILITY: Record<SkillKey, "str" | "dex" | "con" | "int" | "wis" | "cha"> = {
  acrobatics: "dex",
  animalHandling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleightOfHand: "dex",
  stealth: "dex",
  survival: "wis",
};

export const SKILL_LABELS: Record<SkillKey, string> = {
  acrobatics: "Acrobatics",
  animalHandling: "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  sleightOfHand: "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

export function defaultCharacterSheet(): CharacterSheetData {
  const emptySkills = Object.keys(SKILL_ABILITY).reduce((acc, key) => {
    acc[key as SkillKey] = { proficient: false, expertise: false };
    return acc;
  }, {} as Record<SkillKey, { proficient: boolean; expertise: boolean }>);

  const spellSlots: Record<string, { total: number; used: number }> = {};
  for (let lvl = 1; lvl <= 9; lvl++) {
    spellSlots[String(lvl)] = { total: 0, used: 0 };
  }

  return {
    playerName: "",
    race: "",
    classLevel: "",
    background: "",
    alignment: "",
    experiencePoints: 0,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    inspiration: false,
    proficiencyBonus: 2,
    savingThrows: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    skills: emptySkills,
    armorClass: 10,
    initiativeMisc: 0,
    speed: 30,
    hitPointMax: 0,
    hitPointCurrent: 0,
    hitPointTemp: 0,
    hitDiceTotal: "",
    hitDiceCurrent: "",
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    attacks: [],
    equipment: "",
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    proficienciesLanguages: "",
    featuresTraits: "",
    personalityTraits: "",
    ideals: "",
    bonds: "",
    flaws: "",
    spellcastingClass: "",
    spellcastingAbility: "",
    spellSlots,
    spells: [],
  };
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
    spells: (partial.spells ?? base.spells).map((sp) => normalizeSpellEntry(sp as Partial<SpellEntry>)),
  };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// Sheet variables (Action Creator v1, 2026-07-19): every numerical value a
// roll expression may reference. KEYS ARE A STABLE CONTRACT - the Discord
// bot resolves the same keys in discord-bot/src/rolls.ts (resolveSheetVariable
// there); change them in both places or not at all.
// ---------------------------------------------------------------------------

export interface SheetVariable {
  key: string;
  label: string;
  group: string;
}

export const SHEET_VARIABLES: SheetVariable[] = [
  { key: "strMod", label: "Strength modifier", group: "Modifiers" },
  { key: "dexMod", label: "Dexterity modifier", group: "Modifiers" },
  { key: "conMod", label: "Constitution modifier", group: "Modifiers" },
  { key: "intMod", label: "Intelligence modifier", group: "Modifiers" },
  { key: "wisMod", label: "Wisdom modifier", group: "Modifiers" },
  { key: "chaMod", label: "Charisma modifier", group: "Modifiers" },
  { key: "strScore", label: "Strength score", group: "Ability scores" },
  { key: "dexScore", label: "Dexterity score", group: "Ability scores" },
  { key: "conScore", label: "Constitution score", group: "Ability scores" },
  { key: "intScore", label: "Intelligence score", group: "Ability scores" },
  { key: "wisScore", label: "Wisdom score", group: "Ability scores" },
  { key: "chaScore", label: "Charisma score", group: "Ability scores" },
  { key: "prof", label: "Proficiency bonus", group: "Other" },
  { key: "spellMod", label: "Spellcasting ability modifier", group: "Other" },
  { key: "spellAttack", label: "Spell attack bonus (spell mod + prof)", group: "Other" },
  { key: "spellDC", label: "Spell save DC (8 + prof + spell mod)", group: "Other" },
  { key: "level", label: "Character level (parsed from Class & Level)", group: "Other" },
  { key: "ac", label: "Armor class", group: "Other" },
];

/** Resolves a variable key against a sheet. Null for unknown keys - callers
 *  treat that as 0 with a warning rather than refusing to roll. */
export function resolveSheetVariable(sheet: CharacterSheetData, key: string): number | null {
  const abilities = ["str", "dex", "con", "int", "wis", "cha"] as const;
  for (const a of abilities) {
    if (key === `${a}Mod`) return abilityModifier(sheet.abilityScores[a]);
    if (key === `${a}Score`) return sheet.abilityScores[a];
  }
  const spellMod = sheet.spellcastingAbility
    ? abilityModifier(sheet.abilityScores[sheet.spellcastingAbility as (typeof abilities)[number]] ?? 10)
    : 0;
  switch (key) {
    case "prof": return sheet.proficiencyBonus;
    case "spellMod": return spellMod;
    case "spellAttack": return spellMod + sheet.proficiencyBonus;
    case "spellDC": return 8 + sheet.proficiencyBonus + spellMod;
    case "level": {
      // "Wizard 5" / "Fighter 3 / Rogue 2" -> first number found, else 1.
      const m = (sheet.classLevel ?? "").match(/\d+/);
      return m ? Number(m[0]) : 1;
    }
    case "ac": return sheet.armorClass;
    default: return null;
  }
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
export function normalizeAttackEntry(atk: Partial<AttackEntry> & Record<string, unknown>): AttackEntry {
  const legacyBits: string[] = [];
  if (typeof atk.atkBonus === "string" && atk.atkBonus.trim()) legacyBits.push(`Atk ${atk.atkBonus.trim()}`);
  if (typeof atk.damage === "string" && atk.damage.trim()) legacyBits.push(`Damage ${atk.damage.trim()}`);
  const baseDescription = typeof atk.description === "string" ? atk.description : "";
  const description =
    baseDescription || (legacyBits.length ? legacyBits.join(" \u00B7 ") : "");
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
