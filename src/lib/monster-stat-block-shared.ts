// Pure, client-safe helpers for the monster stat block - no database imports
// here, mirroring character-sheet-shared.ts's split (server-side load/save
// lives in creature-queries.ts). Lets the homebrew "blank template" creation
// form (Bestiary/CreatureStatBlockForm.tsx) pull this in without webpack
// trying to bundle node:fs/node:path from db.ts.
import type { MonsterStatBlock } from "./types";

export const CREATURE_SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const;

export const CREATURE_TYPES = [
  "Aberration",
  "Beast",
  "Celestial",
  "Construct",
  "Dragon",
  "Elemental",
  "Fey",
  "Fiend",
  "Giant",
  "Humanoid",
  "Monstrosity",
  "Ooze",
  "Plant",
  "Undead",
] as const;

// Every fractional-or-whole challenge rating used by the 5e SRD, in display order.
export const CHALLENGE_RATINGS = [
  "0",
  "1/8",
  "1/4",
  "1/2",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
] as const;

export function defaultStatBlock(): MonsterStatBlock {
  return {
    size: "Medium",
    creatureType: "Humanoid",
    alignment: "Unaligned",
    speed: "30 ft.",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: "",
    skills: "",
    damageVulnerabilities: "",
    damageResistances: "",
    damageImmunities: "",
    conditionImmunities: "",
    senses: "passive Perception 10",
    languages: "",
    challengeRating: "0",
    xp: 0,
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
  };
}

export function mergeStatBlockWithDefaults(partial: Partial<MonsterStatBlock>): MonsterStatBlock {
  const base = defaultStatBlock();
  return {
    ...base,
    ...partial,
    abilityScores: { ...base.abilityScores, ...(partial.abilityScores ?? {}) },
    traits: partial.traits ?? base.traits,
    actions: partial.actions ?? base.actions,
    bonusActions: partial.bonusActions ?? base.bonusActions,
    reactions: partial.reactions ?? base.reactions,
    legendaryActions: partial.legendaryActions ?? base.legendaryActions,
  };
}

/** Standard 5e ability-modifier math, same formula as character-sheet-shared.ts's abilityModifier. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** CR -> proficiency bonus, per the standard 5e table - used to auto-suggest a saving-throw/skill bonus when hand-building a homebrew monster. */
export function proficiencyBonusForCr(cr: string): number {
  const n = cr.includes("/") ? 0 : Number(cr) || 0;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 12) return 4;
  if (n <= 16) return 5;
  if (n <= 20) return 6;
  if (n <= 24) return 7;
  if (n <= 28) return 8;
  return 9;
}
