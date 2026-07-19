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

/** Builds a RollTrigger straight from a normalized target key (ability or
 *  skill) - used by the website roll bridge (rollQueue.ts), which has no
 *  message text to parse. Same normalization rules as findRollTrigger. */
export function triggerForTarget(target: string): RollTrigger | null {
  const key = target.trim().toLowerCase().replace(/\s+/g, "");
  if (SKILL_TO_ABILITY[key]) {
    return { raw: key, target: key, isSkill: true, label: SKILL_LABELS[key] };
  }
  if (ABILITY_ALIASES[key]) {
    const ability = ABILITY_ALIASES[key];
    return { raw: key, target: ability, isSkill: false, label: ABILITY_LABELS[ability] };
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

// ---------------------------------------------------------------------------
// Action rolls (Action Creator v1, 2026-07-19). Executes the roll
// expressions defined on character-sheet spell entries: count d die +
// modifier, where any slot may be a sheet-variable key. THE VARIABLE KEYS
// ARE A STABLE CONTRACT with SHEET_VARIABLES in the website's
// src/lib/character-sheet-shared.ts - change them in both places or not at
// all. Sanity clamps keep a mistyped "[strScore]d[strScore]" from rolling
// three hundred dice into the channel.
// ---------------------------------------------------------------------------

export interface ActionRollSpec {
  id?: string;
  label?: string;
  count: number | string;
  die: number | string;
  /** Current shape: any number of additive terms (2026-07-20). */
  modifiers?: (number | string)[];
  /** Legacy single-slot shape (2026-07-19) - still honored. */
  modifier?: number | string;
}

function sheetAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function resolveSheetVariable(sheet: Record<string, unknown> | null, key: string): number | null {
  if (!sheet) return null;
  const scores = (sheet.abilityScores as Record<string, number>) ?? {};
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  for (const a of abilities) {
    if (key === `${a}Mod`) return sheetAbilityModifier(scores[a] ?? 10);
    if (key === `${a}Score`) return scores[a] ?? 10;
  }
  const prof = (sheet.proficiencyBonus as number) ?? 2;
  const castAbility = (sheet.spellcastingAbility as string) ?? "";
  const spellMod = castAbility ? sheetAbilityModifier(scores[castAbility] ?? 10) : 0;
  switch (key) {
    case "prof": return prof;
    case "spellMod": return spellMod;
    case "spellAttack": return spellMod + prof;
    case "spellDC": return 8 + prof + spellMod;
    case "level": {
      const m = String(sheet.classLevel ?? "").match(/\d+/);
      return m ? Number(m[0]) : 1;
    }
    case "ac": return (sheet.armorClass as number) ?? 10;
    default: return null;
  }
}

function resolvePart(sheet: Record<string, unknown> | null, part: number | string): { value: number; note: string | null } {
  if (typeof part === "number") return { value: part, note: null };
  const resolved = resolveSheetVariable(sheet, part);
  if (resolved === null) return { value: 0, note: `unknown variable "${part}" treated as 0` };
  return { value: resolved, note: null };
}

export interface ActionRollResult {
  label: string;
  total: number;
  breakdown: string;
}

/** Rolls one action-roll expression against a sheet. Clamps: 1-40 dice,
 *  d2-d1000, modifier -999..999 - generous for real systems, fatal to typos. */
export function computeActionRoll(sheet: Record<string, unknown> | null, spec: ActionRollSpec): ActionRollResult {
  const notes: string[] = [];
  const countR = resolvePart(sheet, spec.count);
  const dieR = resolvePart(sheet, spec.die);
  const modParts = Array.isArray(spec.modifiers)
    ? spec.modifiers
    : spec.modifier !== undefined
      ? [spec.modifier]
      : [];
  const resolvedMods = modParts.map((m) => resolvePart(sheet, m));
  for (const r of [countR, dieR, ...resolvedMods]) if (r.note) notes.push(r.note);

  const count = Math.min(40, Math.max(1, Math.floor(countR.value) || 1));
  const die = Math.min(1000, Math.max(2, Math.floor(dieR.value) || 2));
  const modifierSum = Math.min(
    999,
    Math.max(-999, resolvedMods.reduce((sum, r) => sum + (Math.floor(r.value) || 0), 0))
  );
  if (count !== countR.value && typeof spec.count !== "string") notes.push(`dice count clamped to ${count}`);

  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(Math.floor(Math.random() * die) + 1);
  const sum = dice.reduce((a, b) => a + b, 0);
  const total = sum + modifierSum;

  const diceShown = dice.length <= 10 ? dice.join(",") : `${dice.slice(0, 10).join(",")},…`;
  // Show each term as rolled - "1d20(11)+3+2" reads like the sheet does.
  const modStr = resolvedMods
    .map((r) => {
      const v = Math.floor(r.value) || 0;
      return v === 0 ? "" : v > 0 ? `+${v}` : `${v}`;
    })
    .join("");
  let breakdown = `${count}d${die}(${diceShown})${modStr}`;
  if (notes.length) breakdown += ` [${notes.join("; ")}]`;
  return { label: spec.label || "Roll", total, breakdown };
}
