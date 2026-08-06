// Sheet-template validation (Sheet Engine Phase B, 2026-08-06). Client-safe
// and dependency-free on purpose: the SheetTemplateEditor runs these checks
// live as the DM types, and the server action runs the SAME checks before
// saving - nothing broken can be stored. Deliberately a separate module from
// sheet-engine.ts, which is a byte-identical mirror contract with the bot
// (discord-bot/src/sheet-engine.ts) and must not grow website-only helpers.
import {
  SHEET_TEMPLATE_5E,
  defaultSheetDataForTemplate,
  evaluateFormula,
  makeSheetResolver,
  sanitizeSheetTemplate,
  type SheetTemplateDef,
} from "./sheet-engine";

export interface TemplateIssue {
  /** Where the problem lives, e.g. 'variable strMod', 'formula skillBonus'. */
  where: string;
  message: string;
}

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Structural + formula validation of a template definition. Assumes the
 * shape has already passed sanitizeSheetTemplate (the editor keeps its state
 * well-shaped; the server sanitizes first) - this layer catches what
 * sanitization deliberately lets through: formulas that don't evaluate,
 * duplicate/reserved keys, references to nothing. Every formula is evaluated
 * against the template's OWN default sheet, so "does this work on a real
 * character" is the actual test.
 */
export function validateSheetTemplate(def: SheetTemplateDef): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const sample = defaultSheetDataForTemplate(def);
  const resolver = makeSheetResolver(def, sample);

  if (def.abilities.length === 0) {
    issues.push({ where: "abilities", message: "A system needs at least one ability." });
  }
  const abilityKeys = new Set(def.abilities.map((a) => a.key));
  for (const a of def.abilities) {
    if (!KEY_RE.test(a.key)) issues.push({ where: `ability ${a.key || "(empty)"}`, message: "Keys start with a letter and use only letters, digits and _." });
    if (!a.label.trim()) issues.push({ where: `ability ${a.key}`, message: "Needs a display label." });
  }
  const skillKeys = new Set<string>();
  for (const s of def.skills) {
    if (!KEY_RE.test(s.key)) issues.push({ where: `skill ${s.key || "(empty)"}`, message: "Keys start with a letter and use only letters, digits and _." });
    if (skillKeys.has(s.key)) issues.push({ where: `skill ${s.key}`, message: "Duplicate skill key." });
    skillKeys.add(s.key);
    if (!abilityKeys.has(s.ability)) issues.push({ where: `skill ${s.key}`, message: `Derives from unknown ability "${s.ability}".` });
  }

  const varKeys = new Set<string>();
  for (const v of def.variables) {
    if (varKeys.has(v.key)) issues.push({ where: `variable ${v.key}`, message: "Duplicate variable key." });
    varKeys.add(v.key);
    const value = resolver.variable(v.key);
    if (value === null) issues.push({ where: `variable ${v.key}`, message: "Unknown variable (this should not happen - re-add it)." });
    // A formula variable that silently collapsed to 0 because it failed to
    // parse is the classic typo - re-evaluate the raw formula to tell a real
    // 0 apart from a broken expression.
    if (v.formula !== undefined && evaluateFormula(v.formula, resolver.ctx, {}) === null) {
      issues.push({ where: `variable ${v.key}`, message: `Formula doesn't evaluate: "${v.formula}"` });
    }
  }

  const f = def.formulas;
  if (evaluateFormula(f.abilityMod, resolver.ctx, { score: 12 }) === null) {
    issues.push({ where: "formula abilityMod", message: `Doesn't evaluate (locals: score): "${f.abilityMod}"` });
  }
  if (evaluateFormula(f.skillBonus, resolver.ctx, { abilityMod: 1, prof: 2, profRank: 1 }) === null) {
    issues.push({ where: "formula skillBonus", message: `Doesn't evaluate (locals: abilityMod, prof, profRank): "${f.skillBonus}"` });
  }
  if (evaluateFormula(f.saveBonus, resolver.ctx, { abilityMod: 1, prof: 2, profRank: 1 }) === null) {
    issues.push({ where: "formula saveBonus", message: `Doesn't evaluate (locals: abilityMod, prof, profRank): "${f.saveBonus}"` });
  }
  if (evaluateFormula(f.initiative, resolver.ctx, {}) === null) {
    issues.push({ where: "formula initiative", message: `Doesn't evaluate: "${f.initiative}"` });
  }
  if (evaluateFormula(f.spellSaveDc, resolver.ctx, {}) === null) {
    issues.push({ where: "formula spellSaveDc", message: `Doesn't evaluate: "${f.spellSaveDc}"` });
  }
  if (evaluateFormula(f.spellAttack, resolver.ctx, {}) === null) {
    issues.push({ where: "formula spellAttack", message: `Doesn't evaluate: "${f.spellAttack}"` });
  }
  for (const p of f.passives) {
    if (evaluateFormula(p.formula, resolver.ctx, {}) === null) {
      issues.push({ where: `passive ${p.label}`, message: `Doesn't evaluate: "${p.formula}"` });
    }
  }
  return issues;
}

/** The minimal starting skeleton for a from-scratch system: one ability, no
 *  skills, everything 5e-ish switched off. Passes validation as-is. */
export function minimalTemplateDef(name: string): SheetTemplateDef {
  return sanitizeSheetTemplate({
    engine: 1,
    system: "custom",
    name,
    abilities: [{ key: "might", label: "Might", short: "MGT" }],
    skills: [],
    expertise: false,
    spellSlotLevels: 0,
    coins: [{ key: "coin", label: "Coins" }],
    variables: [
      { key: "mightScore", label: "Might score", group: "Ability scores", path: "abilityScores.might" },
      { key: "mightMod", label: "Might modifier", group: "Modifiers", formula: "floor((mightScore - 10) / 2)" },
      { key: "prof", label: "Proficiency bonus", group: "Other", path: "proficiencyBonus" },
    ],
    formulas: {
      abilityMod: "floor((score - 10) / 2)",
      skillBonus: "abilityMod + prof * profRank",
      saveBonus: "abilityMod + prof * profRank",
      initiative: "mightMod",
      passives: [],
      spellSaveDc: "0",
      spellAttack: "0",
    },
    features: {
      inspiration: false,
      experiencePoints: false,
      alignment: false,
      hitDice: false,
      deathSaves: false,
      attacks: true,
      customActions: true,
      equipment: true,
      personality: false,
      proficienciesLanguages: false,
      spellcasting: false,
    },
  })!;
}

/** A deep, independently-editable copy of the seeded 5e system. */
export function fiveETemplateDef(name: string): SheetTemplateDef {
  const copy = JSON.parse(JSON.stringify(SHEET_TEMPLATE_5E)) as SheetTemplateDef;
  copy.name = name;
  copy.system = "custom-5e";
  return copy;
}
