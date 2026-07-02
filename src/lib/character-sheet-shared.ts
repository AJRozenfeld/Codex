// Pure, client-safe helpers and constants for the 5e character sheet - no
// database imports here, so this file can be pulled into the "use client"
// CharacterSheetForm without webpack trying to bundle node:fs/node:path from
// db.ts. Server-side load/save lives in character-sheet.ts, which re-exports
// everything from this module too.
import type { CharacterSheetData, SkillKey } from "./types";

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
    attacks: partial.attacks ?? base.attacks,
    spells: partial.spells ?? base.spells,
  };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
