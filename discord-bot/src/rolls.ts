// ---------------------------------------------------------------------------
// Inline dice-roll parsing for masked messages. Aviv's spec (2026-07-06):
// every roll must be gated behind a mask - this module never runs on bare
// text, only on the portion of a message after a valid [[mask]]: prefix (see
// messageHandler.ts). Trigger syntax is deliberately tight -
// *roll <ability or skill>* - rather than free-parsing roleplay prose, to
// avoid false positives on ordinary emotes like "*rolls their eyes*".
// ---------------------------------------------------------------------------

const ROLL_PATTERN = /\*roll\s+([a-z ]+?)\*/i;

const ABILITY_ALIASES: Record<string, string> = {
  str: "str", strength: "str",
  dex: "dex", dexterity: "dex",
  con: "con", constitution: "con",
  int: "int", intelligence: "int",
  wis: "wis", wisdom: "wis",
  cha: "cha", charisma: "cha",
};

const SKILL_TO_ABILITY: Record<string, string> = {
  acrobatics: "dex",
  animalhandling: "wis",
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
  sleightofhand: "dex",
  stealth: "dex",
  survival: "wis",
};

const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Acrobatics", animalhandling: "Animal Handling", arcana: "Arcana", athletics: "Athletics",
  deception: "Deception", history: "History", insight: "Insight", intimidation: "Intimidation",
  investigation: "Investigation", medicine: "Medicine", nature: "Nature", perception: "Perception",
  performance: "Performance", persuasion: "Persuasion", religion: "Religion", sleightofhand: "Sleight of Hand",
  stealth: "Stealth", survival: "Survival",
};

const ABILITY_LABELS: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

export interface RollTrigger {
  /** The raw text matched, e.g. "*roll strength*" - stripped from nothing, kept in the spoken line as-is. */
  raw: string;
  /** Normalized target key: an AbilityKey (e.g. "str") or a SkillKey (e.g. "perception"). */
  target: string;
  isSkill: boolean;
  label: string;
}

export function findRollTrigger(text: string): RollTrigger | null {
  const m = text.match(ROLL_PATTERN);
  if (!m) return null;
  const rawTarget = m[1].trim().toLowerCase().replace(/\s+/g, "");
  if (SKILL_TO_ABILITY[rawTarget]) {
    return { raw: m[0], target: rawTarget, isSkill: true, label: SKILL_LABELS[rawTarget] };
  }
  if (ABILITY_ALIASES[rawTarget]) {
    const ability = ABILITY_ALIASES[rawTarget];
    return { raw: m[0], target: ability, isSkill: false, label: ABILITY_LABELS[ability] };
  }
  return null;
}

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export interface RollComputation {
  d20: number;
  modifier: number;
  total: number;
  breakdown: string;
}

/**
 * Computes a roll against a character_sheets.data blob (see BotCharacter /
 * getCharacterSheetData in db.ts). Falls back to a flat +0 modifier (still
 * rolls, just unmodified) if the character has no sheet yet, rather than
 * refusing to roll at all - a DM improvising an unstatted NPC still wants a
 * d20.
 */
export function computeRoll(sheet: Record<string, unknown> | null, trigger: RollTrigger): RollComputation {
  const d20 = rollD20();
  if (!sheet) return { d20, modifier: 0, total: d20, breakdown: `${d20} (no sheet on file, no modifier)` };

  const abilityScores = (sheet.abilityScores as Record<string, number>) ?? {};
  const proficiencyBonus = (sheet.proficiencyBonus as number) ?? 2;
  const abilityKey = trigger.isSkill ? SKILL_TO_ABILITY[trigger.target] : trigger.target;
  const score = abilityScores[abilityKey] ?? 10;
  const abilityMod = Math.floor((score - 10) / 2);

  let modifier = abilityMod;
  let breakdown = `${d20} + ${abilityMod} (${ABILITY_LABELS[abilityKey]})`;

  if (trigger.isSkill) {
    const skills = (sheet.skills as Record<string, { proficient?: boolean; expertise?: boolean }>) ?? {};
    const skill = skills[trigger.target];
    if (skill?.proficient) {
      const bonus = skill.expertise ? proficiencyBonus * 2 : proficiencyBonus;
      modifier += bonus;
      breakdown += ` + ${bonus} (${skill.expertise ? "expertise" : "proficiency"})`;
    }
  }

  return { d20, modifier, total: d20 + modifier, breakdown };
}

/**
 * Initiative (2026-07-06): d20 + Dexterity modifier, no proficiency bonus -
 * base 5e initiative. Triggered by a bare `[[mask]]: *init*` (or
 * `*initiative*`), deliberately a SEPARATE pattern from `*roll <ability>*`
 * (see messageHandler.ts) rather than just another ability alias, because a
 * matched initiative roll also needs to feed the battle tracker - a plain
 * `*roll dexterity*` should never do that.
 */
export function computeInitiative(sheet: Record<string, unknown> | null): RollComputation {
  return computeRoll(sheet, { raw: "*init*", target: "dex", isSkill: false, label: "Initiative" });
}
