// ---------------------------------------------------------------------------
// The Sheet Engine - Phase A (2026-08-06).
//
// A character sheet's SYSTEM (which abilities exist, which skills derive from
// which ability, how a modifier is computed, which variables a roll
// expression may reference) becomes DATA - a SheetTemplateDef - instead of
// code. The 2014 5e sheet that every existing character uses is now just the
// seeded template below (SHEET_TEMPLATE_5E), and CharacterSheetView /
// CharacterSheetForm render whatever template they're handed. Phase B adds
// the DM-facing template editor on top of this substrate; Phase C stitches
// the Discord bot + VTT through the same definitions.
//
// PARITY IS THE CONTRACT OF THIS PHASE: for the seeded 5e template, every
// number this engine produces must equal what the previously-hardcoded math
// produced - the parity drill (scripts, see the Phase A commit) asserts
// engine-vs-legacy equality across randomized sheets. The legacy exports in
// character-sheet-shared.ts (SKILL_ABILITY, SHEET_VARIABLES,
// resolveSheetVariable, abilityModifier...) are now thin derivations of the
// 5e template - one source of truth, zero call-site churn.
//
// THE VARIABLE KEYS OF THE 5E TEMPLATE REMAIN A STABLE CONTRACT with the
// Discord bot (discord-bot/src/rolls.ts resolveSheetVariable) - the bot
// still hardcodes 5e; custom templates roll on the website's terms only
// until the bot learns templates in a later phase.
//
// This module is dependency-free and client-safe (same rule as
// blueprint-shared.ts) - no db imports, importable from "use client" files.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Template definition types
// ---------------------------------------------------------------------------

export interface SheetAbilityDef {
  /** Stable key, e.g. "str" - doubles as the roll target and the
   *  abilityScores record key. Lowercase, no spaces. */
  key: string;
  label: string;
  /** Short display form for the carved stones, e.g. "STR". */
  short: string;
}

export interface SheetSkillDef {
  /** Stable key, e.g. "sleightOfHand" - doubles as the roll target and the
   *  skills record key. */
  key: string;
  label: string;
  /** Key of the ability this skill derives from. */
  ability: string;
}

/** One variable a roll expression (ActionRoll) may reference. Exactly one of
 *  `path` / `formula` is set: a path variable reads a number straight off the
 *  sheet data blob; a formula variable is computed from other variables and
 *  the builtin functions. */
export interface SheetVariableDef {
  key: string;
  label: string;
  /** Picker optgroup in the roll editor, e.g. "Modifiers". */
  group: string;
  path?: string;
  formula?: string;
}

/** The derived-stat rules of the system, each an expression string. The
 *  locals available to each formula are documented per field. */
export interface SheetFormulas {
  /** Locals: `score`. The 5e classic: floor((score - 10) / 2). */
  abilityMod: string;
  /** Locals: `abilityMod`, `prof`, `profRank`. profRank counts proficiency
   *  and expertise independently (0/1/2) - matching the site's historical
   *  behavior where expertise adds prof even without base proficiency. */
  skillBonus: string;
  /** Locals: `abilityMod`, `prof`, `profRank` (0/1). */
  saveBonus: string;
  /** No locals - template variables + builtins only. */
  initiative: string;
  /** Passive senses shown on the sheet. No locals; skill("key") builtin
   *  resolves a skill's full bonus. */
  passives: { label: string; formula: string }[];
  /** No locals. */
  spellSaveDc: string;
  /** No locals. */
  spellAttack: string;
}

/** Feature flags: which macro-sections of the sheet exist in this system.
 *  The renderer hides what a template turns off - a lean homebrew system
 *  isn't forced to carry 5e-isms. */
export interface SheetFeatures {
  inspiration: boolean;
  experiencePoints: boolean;
  alignment: boolean;
  hitDice: boolean;
  deathSaves: boolean;
  attacks: boolean;
  customActions: boolean;
  equipment: boolean;
  personality: boolean;
  proficienciesLanguages: boolean;
  spellcasting: boolean;
}

export interface SheetCoinDef {
  /** Currency record key, e.g. "gp". */
  key: string;
  label: string;
}

export interface SheetTemplateDef {
  /** Engine format version - bump if this shape ever changes incompatibly. */
  engine: 1;
  /** Machine name of the system, e.g. "dnd5e-2014". */
  system: string;
  /** Display name, e.g. "D&D 5e (2014)". */
  name: string;
  abilities: SheetAbilityDef[];
  skills: SheetSkillDef[];
  /** Whether skills carry a second (expertise) proficiency tier. */
  expertise: boolean;
  /** Highest spell-slot level rendered (5e: 9). 0 with spellcasting on
   *  means "spells but no slot grid". */
  spellSlotLevels: number;
  coins: SheetCoinDef[];
  variables: SheetVariableDef[];
  formulas: SheetFormulas;
  features: SheetFeatures;
}

/** The fixed id under which the seeded 5e template is addressed. A campaign
 *  whose sheet_template_id is NULL or this value renders through the code
 *  constant below - zero extra database round trips on the hot sheet path
 *  (see the 2026-07-14 perf-pass memory for why that matters on Turso). */
export const PLATFORM_5E_TEMPLATE_ID = "platform-5e-2014";

// ---------------------------------------------------------------------------
// Expression evaluator. A deliberately tiny recursive-descent parser -
// numbers, + - * /, parentheses, unary minus, identifiers (template
// variables), string literals (only as function arguments) and a fixed set
// of builtin functions. No eval(), no Function(), no property access.
//
// Builtins:
//   floor(x) ceil(x) round(x) abs(x) min(a,b,...) max(a,b,...)
//   clamp(x, lo, hi)
//   num("dot.path" [, fallback])        - numeric field read off the sheet
//   firstNumber("dot.path" [, fallback])- first integer inside a text field
//                                         (how 5e reads level out of "Fighter 3")
//   lookup("dot.path", "suffix" [, fallback])
//                                       - indirection: read a STRING field,
//                                         append suffix, resolve THAT
//                                         variable ("spellcastingAbility" +
//                                         "Mod" -> chaMod). Empty selector
//                                         -> fallback (default 0).
//   skill("key")                        - a skill's full computed bonus
//
// Unknown identifiers and malformed expressions resolve to null; callers
// treat null as 0 where display demands a number. Division by zero and any
// non-finite intermediate result collapse to 0 rather than poisoning a
// sheet with NaN.
// ---------------------------------------------------------------------------

export interface FormulaContext {
  /** Resolve a template variable by key - null if unknown. */
  vars: (key: string) => number | null;
  /** Read a numeric field off the sheet blob - null if absent/non-numeric. */
  num: (path: string) => number | null;
  /** Read a string field off the sheet blob - null if absent. */
  str: (path: string) => string | null;
  /** A skill's full bonus - null if unknown. */
  skill: (key: string) => number | null;
}

type Token =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j++;
      if (j >= src.length) return null; // unterminated
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null; // unknown character
  }
  return out;
}

const MAX_EVAL_DEPTH = 16;

class FormulaError extends Error {}

/** Wraps every arithmetic result: anything non-finite becomes 0 so a
 *  template typo can't render "NaN" across a player's sheet. */
function fin(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function evaluateTokens(tokens: Token[], ctx: FormulaContext, locals: Record<string, number>, depth: number): number {
  let pos = 0;

  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expectOp = (v: string) => {
    const tk = take();
    if (!tk || tk.t !== "op" || tk.v !== v) throw new FormulaError(`expected ${v}`);
  };

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = take().v;
      const right = parseTerm();
      left = fin(op === "+" ? left + right : left - right);
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = take().v;
      const right = parseUnary();
      left = fin(op === "*" ? left * right : right === 0 ? 0 : left / right);
    }
    return left;
  }

  function parseUnary(): number {
    if (peek() && peek().t === "op" && peek().v === "-") {
      take();
      return fin(-parseUnary());
    }
    return parsePrimary();
  }

  function parseArgs(): (number | string)[] {
    expectOp("(");
    const args: (number | string)[] = [];
    if (peek() && !(peek().t === "op" && peek().v === ")")) {
      for (;;) {
        if (peek() && peek().t === "str") {
          args.push((take() as { t: "str"; v: string }).v);
        } else {
          args.push(parseExpr());
        }
        if (peek() && peek().t === "op" && peek().v === ",") { take(); continue; }
        break;
      }
    }
    expectOp(")");
    return args;
  }

  function callFn(name: string, args: (number | string)[]): number {
    const nums = args.filter((a): a is number => typeof a === "number");
    const strs = args.filter((a): a is string => typeof a === "string");
    switch (name) {
      case "floor": return fin(Math.floor(nums[0] ?? 0));
      case "ceil": return fin(Math.ceil(nums[0] ?? 0));
      case "round": return fin(Math.round(nums[0] ?? 0));
      case "abs": return fin(Math.abs(nums[0] ?? 0));
      case "min": return nums.length ? fin(Math.min(...nums)) : 0;
      case "max": return nums.length ? fin(Math.max(...nums)) : 0;
      case "clamp": {
        const [x = 0, lo = 0, hi = 0] = nums;
        return fin(Math.max(lo, Math.min(hi, x)));
      }
      case "num": {
        if (!strs[0]) throw new FormulaError("num() needs a path");
        const v = ctx.num(strs[0]);
        return v === null ? (nums[0] ?? 0) : fin(v);
      }
      case "firstNumber": {
        if (!strs[0]) throw new FormulaError("firstNumber() needs a path");
        const raw = ctx.str(strs[0]);
        const m = (raw ?? "").match(/\d+/);
        return m ? fin(Number(m[0])) : (nums[0] ?? 0);
      }
      case "lookup": {
        if (strs.length < 2) throw new FormulaError("lookup() needs a path and a suffix");
        const selector = (ctx.str(strs[0]) ?? "").trim();
        if (!selector) return nums[0] ?? 0;
        if (depth + 1 > MAX_EVAL_DEPTH) throw new FormulaError("formula depth exceeded");
        const v = ctx.vars(`${selector}${strs[1]}`);
        return v === null ? (nums[0] ?? 0) : fin(v);
      }
      case "skill": {
        if (!strs[0]) throw new FormulaError("skill() needs a key");
        const v = ctx.skill(strs[0]);
        return v === null ? 0 : fin(v);
      }
      default:
        throw new FormulaError(`unknown function ${name}`);
    }
  }

  function parsePrimary(): number {
    const tk = take();
    if (!tk) throw new FormulaError("unexpected end");
    if (tk.t === "num") return tk.v;
    if (tk.t === "op" && tk.v === "(") {
      const v = parseExpr();
      expectOp(")");
      return v;
    }
    if (tk.t === "ident") {
      if (peek() && peek().t === "op" && peek().v === "(") {
        return callFn(tk.v, parseArgs());
      }
      if (Object.prototype.hasOwnProperty.call(locals, tk.v)) return fin(locals[tk.v]);
      if (depth + 1 > MAX_EVAL_DEPTH) throw new FormulaError("formula depth exceeded");
      const v = ctx.vars(tk.v);
      if (v === null) throw new FormulaError(`unknown identifier ${tk.v}`);
      return fin(v);
    }
    throw new FormulaError("unexpected token");
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new FormulaError("trailing tokens");
  return fin(result);
}

/** Evaluates one expression. Null on any parse/resolution error - the
 *  renderer decides how to display a broken formula; it never throws. */
export function evaluateFormula(
  expr: string,
  ctx: FormulaContext,
  locals: Record<string, number> = {},
  depth = 0
): number | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  try {
    return evaluateTokens(tokens, ctx, locals, depth);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sheet data access. The engine reads the sheet as a plain object via dot
// paths so it stays agnostic to CharacterSheetData's exact TypeScript shape -
// a custom system's blob carries the same top-level layout with its own
// ability/skill keys inside the records.
// ---------------------------------------------------------------------------

export type SheetLike = Record<string, unknown>;

function readPath(sheet: SheetLike, path: string): unknown {
  let cur: unknown = sheet;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function readNum(sheet: SheetLike, path: string): number | null {
  const v = readPath(sheet, path);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readStr(sheet: SheetLike, path: string): string | null {
  const v = readPath(sheet, path);
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// The resolver: template + sheet -> every derived number. Variables are
// memoized per resolver; a variable whose formula references itself (or a
// cycle) bottoms out via the shared depth cap and resolves null.
// ---------------------------------------------------------------------------

export interface SheetResolver {
  ctx: FormulaContext;
  /** Resolve a template variable - null for unknown keys (the caller may
   *  treat that as 0 with a warning, mirroring the roll pipeline). */
  variable: (key: string) => number | null;
  abilityScore: (abilityKey: string) => number;
  abilityMod: (abilityKey: string) => number;
  skillBonus: (skillKey: string) => number;
  saveBonus: (abilityKey: string) => number;
}

export function abilityModFor(template: SheetTemplateDef, score: number): number {
  const v = evaluateFormula(template.formulas.abilityMod, EMPTY_CTX, { score });
  return v === null ? 0 : v;
}

const EMPTY_CTX: FormulaContext = {
  vars: () => null,
  num: () => null,
  str: () => null,
  skill: () => null,
};

export function makeSheetResolver(template: SheetTemplateDef, sheet: SheetLike): SheetResolver {
  const varDefs = new Map(template.variables.map((v) => [v.key, v]));
  const memo = new Map<string, number | null>();
  const inFlight = new Set<string>();

  const ctx: FormulaContext = {
    vars: (key) => variable(key),
    num: (path) => readNum(sheet, path),
    str: (path) => readStr(sheet, path),
    skill: (key) => (template.skills.some((s) => s.key === key) ? skillBonus(key) : null),
  };

  function variable(key: string): number | null {
    if (memo.has(key)) return memo.get(key)!;
    if (inFlight.has(key)) return null; // cycle - refuse rather than recurse
    const def = varDefs.get(key);
    if (!def) return null;
    inFlight.add(key);
    let value: number | null;
    if (def.path) {
      value = readNum(sheet, def.path);
      // A path variable on a merged sheet should always land; if the field
      // is genuinely absent, surface 0 rather than null so the variable
      // still "exists" to the roll editor - only UNKNOWN keys are null.
      if (value === null) value = 0;
    } else if (def.formula) {
      value = evaluateFormula(def.formula, ctx, {});
      if (value === null) value = 0;
    } else {
      value = 0;
    }
    inFlight.delete(key);
    memo.set(key, value);
    return value;
  }

  function abilityScore(abilityKey: string): number {
    const v = readNum(sheet, `abilityScores.${abilityKey}`);
    return v === null ? 10 : v;
  }

  function abilityMod(abilityKey: string): number {
    return abilityModFor(template, abilityScore(abilityKey));
  }

  function profBonus(): number {
    const v = readNum(sheet, "proficiencyBonus");
    return v === null ? 0 : v;
  }

  function skillBonus(skillKey: string): number {
    const def = template.skills.find((s) => s.key === skillKey);
    if (!def) return 0;
    const entry = readPath(sheet, `skills.${skillKey}`) as { proficient?: boolean; expertise?: boolean } | undefined;
    const profRank = (entry?.proficient ? 1 : 0) + (template.expertise && entry?.expertise ? 1 : 0);
    const v = evaluateFormula(template.formulas.skillBonus, ctx, {
      abilityMod: abilityMod(def.ability),
      prof: profBonus(),
      profRank,
    });
    return v === null ? 0 : v;
  }

  function saveBonus(abilityKey: string): number {
    const proficient = Boolean(readPath(sheet, `savingThrows.${abilityKey}`));
    const v = evaluateFormula(template.formulas.saveBonus, ctx, {
      abilityMod: abilityMod(abilityKey),
      prof: profBonus(),
      profRank: proficient ? 1 : 0,
    });
    return v === null ? 0 : v;
  }

  return { ctx, variable, abilityScore, abilityMod, skillBonus, saveBonus };
}

/** One-shot variable resolution - what the roll pipeline and the legacy
 *  resolveSheetVariable wrapper use. Null for unknown keys. */
export function resolveTemplateVariable(template: SheetTemplateDef, sheet: SheetLike, key: string): number | null {
  return makeSheetResolver(template, sheet).variable(key);
}

/** The headline derived numbers the sheet chrome displays. */
export interface SheetDerived {
  initiative: number;
  passives: { label: string; value: number }[];
  spellSaveDc: number;
  spellAttack: number;
}

export function computeSheetDerived(template: SheetTemplateDef, sheet: SheetLike): SheetDerived {
  const r = makeSheetResolver(template, sheet);
  const evalOr0 = (expr: string) => {
    const v = evaluateFormula(expr, r.ctx, {});
    return v === null ? 0 : v;
  };
  return {
    initiative: evalOr0(template.formulas.initiative),
    passives: template.formulas.passives.map((p) => ({ label: p.label, value: evalOr0(p.formula) })),
    spellSaveDc: evalOr0(template.formulas.spellSaveDc),
    spellAttack: evalOr0(template.formulas.spellAttack),
  };
}

// ---------------------------------------------------------------------------
// Default sheet data for a template. For the 5e template this produces
// exactly what defaultCharacterSheet() always produced (the parity drill
// asserts deep equality) - for a custom system, the ability/skill records
// take the template's keys and everything else keeps the same blob layout,
// which is what lets one character_sheets.data column serve every system.
// ---------------------------------------------------------------------------

export function defaultSheetDataForTemplate(template: SheetTemplateDef): Record<string, unknown> {
  const abilityScores: Record<string, number> = {};
  for (const a of template.abilities) abilityScores[a.key] = 10;
  const savingThrows: Record<string, boolean> = {};
  for (const a of template.abilities) savingThrows[a.key] = false;
  const skills: Record<string, { proficient: boolean; expertise: boolean }> = {};
  for (const s of template.skills) skills[s.key] = { proficient: false, expertise: false };
  const spellSlots: Record<string, { total: number; used: number }> = {};
  for (let lvl = 1; lvl <= template.spellSlotLevels; lvl++) spellSlots[String(lvl)] = { total: 0, used: 0 };
  const currency: Record<string, number> = {};
  for (const c of template.coins) currency[c.key] = 0;

  return {
    playerName: "",
    race: "",
    classLevel: "",
    background: "",
    alignment: "",
    experiencePoints: 0,
    abilityScores,
    inspiration: false,
    proficiencyBonus: 2,
    savingThrows,
    skills,
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
    customActions: [],
    equipment: "",
    currency,
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

// ---------------------------------------------------------------------------
// Template sanitization. A template loaded from the database is a CLAIM
// (same doctrine as sanitizeBlueprintSteps) - coerce every field to its
// expected shape, drop what doesn't parse, and refuse templates that lack
// the minimum a sheet needs. Null = unusable, caller falls back to 5e.
// ---------------------------------------------------------------------------

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

function cleanKey(v: unknown): string | null {
  return typeof v === "string" && KEY_RE.test(v) && v.length <= 40 ? v : null;
}

function cleanText(v: unknown, max = 80): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function cleanFormula(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() && v.length <= 500 ? v : fallback;
}

export function sanitizeSheetTemplate(raw: unknown): SheetTemplateDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const f5 = SHEET_TEMPLATE_5E.formulas;

  const abilities: SheetAbilityDef[] = [];
  if (Array.isArray(o.abilities)) {
    for (const a of o.abilities.slice(0, 20)) {
      const key = cleanKey((a as Record<string, unknown>)?.key);
      if (!key || abilities.some((x) => x.key === key)) continue;
      abilities.push({
        key,
        label: cleanText((a as Record<string, unknown>).label) || key,
        short: cleanText((a as Record<string, unknown>).short, 8) || key.slice(0, 3).toUpperCase(),
      });
    }
  }
  if (abilities.length === 0) return null;

  const skills: SheetSkillDef[] = [];
  if (Array.isArray(o.skills)) {
    for (const s of o.skills.slice(0, 60)) {
      const key = cleanKey((s as Record<string, unknown>)?.key);
      const ability = cleanKey((s as Record<string, unknown>)?.ability);
      if (!key || !ability || skills.some((x) => x.key === key)) continue;
      if (!abilities.some((a) => a.key === ability)) continue;
      skills.push({ key, ability, label: cleanText((s as Record<string, unknown>).label) || key });
    }
  }

  const variables: SheetVariableDef[] = [];
  if (Array.isArray(o.variables)) {
    for (const v of o.variables.slice(0, 120)) {
      const vv = v as Record<string, unknown>;
      const key = cleanKey(vv?.key);
      if (!key || variables.some((x) => x.key === key)) continue;
      const path = typeof vv.path === "string" && vv.path.length <= 120 ? vv.path : undefined;
      const formula = typeof vv.formula === "string" && vv.formula.length <= 500 ? vv.formula : undefined;
      if (!path && !formula) continue;
      variables.push({
        key,
        label: cleanText(vv.label) || key,
        group: cleanText(vv.group, 40) || "Other",
        ...(path ? { path } : {}),
        ...(!path && formula ? { formula } : {}),
      });
    }
  }

  const rawFormulas = (o.formulas ?? {}) as Record<string, unknown>;
  const passives: { label: string; formula: string }[] = [];
  if (Array.isArray(rawFormulas.passives)) {
    for (const p of rawFormulas.passives.slice(0, 10)) {
      const pp = p as Record<string, unknown>;
      if (typeof pp?.formula !== "string" || !pp.formula.trim()) continue;
      passives.push({ label: cleanText(pp.label) || "Passive", formula: pp.formula.slice(0, 500) });
    }
  }

  const rawFeatures = (o.features ?? {}) as Record<string, unknown>;
  const feat = (k: keyof SheetFeatures) =>
    typeof rawFeatures[k] === "boolean" ? (rawFeatures[k] as boolean) : SHEET_TEMPLATE_5E.features[k];

  const coins: SheetCoinDef[] = [];
  if (Array.isArray(o.coins)) {
    for (const c of o.coins.slice(0, 10)) {
      const key = cleanKey((c as Record<string, unknown>)?.key);
      if (!key || coins.some((x) => x.key === key)) continue;
      coins.push({ key, label: cleanText((c as Record<string, unknown>).label) || key });
    }
  }

  const slotLevelsRaw = Number(o.spellSlotLevels);
  return {
    engine: 1,
    system: cleanText(o.system, 60) || "custom",
    name: cleanText(o.name) || "Custom System",
    abilities,
    skills,
    expertise: typeof o.expertise === "boolean" ? o.expertise : false,
    spellSlotLevels: Number.isFinite(slotLevelsRaw) ? Math.max(0, Math.min(9, Math.floor(slotLevelsRaw))) : 0,
    coins,
    variables,
    formulas: {
      abilityMod: cleanFormula(rawFormulas.abilityMod, f5.abilityMod),
      skillBonus: cleanFormula(rawFormulas.skillBonus, f5.skillBonus),
      saveBonus: cleanFormula(rawFormulas.saveBonus, f5.saveBonus),
      initiative: cleanFormula(rawFormulas.initiative, "0"),
      passives,
      spellSaveDc: cleanFormula(rawFormulas.spellSaveDc, "0"),
      spellAttack: cleanFormula(rawFormulas.spellAttack, "0"),
    },
    features: {
      inspiration: feat("inspiration"),
      experiencePoints: feat("experiencePoints"),
      alignment: feat("alignment"),
      hitDice: feat("hitDice"),
      deathSaves: feat("deathSaves"),
      attacks: feat("attacks"),
      customActions: feat("customActions"),
      equipment: feat("equipment"),
      personality: feat("personality"),
      proficienciesLanguages: feat("proficienciesLanguages"),
      spellcasting: feat("spellcasting"),
    },
  };
}

// ---------------------------------------------------------------------------
// The seeded 5e (2014) template - the system every existing sheet uses,
// expressed in the engine's own terms. THE VALUES HERE ARE A PARITY
// CONTRACT with the previously-hardcoded math (and with the Discord bot's
// resolver): touch nothing here without updating the parity drill, the bot,
// or both.
// ---------------------------------------------------------------------------

const ABILITIES_5E: SheetAbilityDef[] = [
  { key: "str", label: "Strength", short: "STR" },
  { key: "dex", label: "Dexterity", short: "DEX" },
  { key: "con", label: "Constitution", short: "CON" },
  { key: "int", label: "Intelligence", short: "INT" },
  { key: "wis", label: "Wisdom", short: "WIS" },
  { key: "cha", label: "Charisma", short: "CHA" },
];

const SKILLS_5E: SheetSkillDef[] = [
  { key: "acrobatics", label: "Acrobatics", ability: "dex" },
  { key: "animalHandling", label: "Animal Handling", ability: "wis" },
  { key: "arcana", label: "Arcana", ability: "int" },
  { key: "athletics", label: "Athletics", ability: "str" },
  { key: "deception", label: "Deception", ability: "cha" },
  { key: "history", label: "History", ability: "int" },
  { key: "insight", label: "Insight", ability: "wis" },
  { key: "intimidation", label: "Intimidation", ability: "cha" },
  { key: "investigation", label: "Investigation", ability: "int" },
  { key: "medicine", label: "Medicine", ability: "wis" },
  { key: "nature", label: "Nature", ability: "int" },
  { key: "perception", label: "Perception", ability: "wis" },
  { key: "performance", label: "Performance", ability: "cha" },
  { key: "persuasion", label: "Persuasion", ability: "cha" },
  { key: "religion", label: "Religion", ability: "int" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dex" },
  { key: "stealth", label: "Stealth", ability: "dex" },
  { key: "survival", label: "Survival", ability: "wis" },
];

export const SHEET_TEMPLATE_5E: SheetTemplateDef = {
  engine: 1,
  system: "dnd5e-2014",
  name: "D&D 5e (2014)",
  abilities: ABILITIES_5E,
  skills: SKILLS_5E,
  expertise: true,
  spellSlotLevels: 9,
  coins: [
    { key: "cp", label: "Copper" },
    { key: "sp", label: "Silver" },
    { key: "ep", label: "Electrum" },
    { key: "gp", label: "Gold" },
    { key: "pp", label: "Platinum" },
  ],
  variables: [
    // KEYS ARE THE STABLE CONTRACT with discord-bot/src/rolls.ts - same set,
    // same order, same groups as the historical SHEET_VARIABLES array.
    { key: "strMod", label: "Strength modifier", group: "Modifiers", formula: "floor((strScore - 10) / 2)" },
    { key: "dexMod", label: "Dexterity modifier", group: "Modifiers", formula: "floor((dexScore - 10) / 2)" },
    { key: "conMod", label: "Constitution modifier", group: "Modifiers", formula: "floor((conScore - 10) / 2)" },
    { key: "intMod", label: "Intelligence modifier", group: "Modifiers", formula: "floor((intScore - 10) / 2)" },
    { key: "wisMod", label: "Wisdom modifier", group: "Modifiers", formula: "floor((wisScore - 10) / 2)" },
    { key: "chaMod", label: "Charisma modifier", group: "Modifiers", formula: "floor((chaScore - 10) / 2)" },
    { key: "strScore", label: "Strength score", group: "Ability scores", path: "abilityScores.str" },
    { key: "dexScore", label: "Dexterity score", group: "Ability scores", path: "abilityScores.dex" },
    { key: "conScore", label: "Constitution score", group: "Ability scores", path: "abilityScores.con" },
    { key: "intScore", label: "Intelligence score", group: "Ability scores", path: "abilityScores.int" },
    { key: "wisScore", label: "Wisdom score", group: "Ability scores", path: "abilityScores.wis" },
    { key: "chaScore", label: "Charisma score", group: "Ability scores", path: "abilityScores.cha" },
    { key: "prof", label: "Proficiency bonus", group: "Other", path: "proficiencyBonus" },
    { key: "spellMod", label: "Spellcasting ability modifier", group: "Other", formula: 'lookup("spellcastingAbility", "Mod")' },
    { key: "spellAttack", label: "Spell attack bonus (spell mod + prof)", group: "Other", formula: "spellMod + prof" },
    { key: "spellDC", label: "Spell save DC (8 + prof + spell mod)", group: "Other", formula: "8 + prof + spellMod" },
    { key: "level", label: "Character level (parsed from Class & Level)", group: "Other", formula: 'firstNumber("classLevel", 1)' },
    { key: "ac", label: "Armor class", group: "Other", path: "armorClass" },
  ],
  formulas: {
    abilityMod: "floor((score - 10) / 2)",
    skillBonus: "abilityMod + prof * profRank",
    saveBonus: "abilityMod + prof * profRank",
    initiative: 'dexMod + num("initiativeMisc")',
    passives: [{ label: "Passive Perception", formula: '10 + skill("perception")' }],
    spellSaveDc: "8 + prof + spellMod",
    spellAttack: "prof + spellMod",
  },
  features: {
    inspiration: true,
    experiencePoints: true,
    alignment: true,
    hitDice: true,
    deathSaves: true,
    attacks: true,
    customActions: true,
    equipment: true,
    personality: true,
    proficienciesLanguages: true,
    spellcasting: true,
  },
};
