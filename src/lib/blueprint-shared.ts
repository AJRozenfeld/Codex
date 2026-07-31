// ---------------------------------------------------------------------------
// Character Creator blueprints (2026-07-31). A Blueprint is the DM's
// per-campaign recipe for character creation: an ordered list of steps, each
// with a method and limits. Shared between the admin editor, the player
// wizard, and the server-side validators - keep it dependency-free (no db
// imports) so both bundles can use it.
// V1 deliberately fills the FIXED 5e sheet (character-sheet-shared.ts); the
// step schema references field keys, not layouts, so the configurable sheet
// engine can slot underneath later without reshaping blueprints.
// ---------------------------------------------------------------------------

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof ABILITIES)[number];
export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

// ------------------------------ stat methods -------------------------------

/** Standard 5e point-buy costs; editable per campaign. Keys are scores. */
export const DEFAULT_POINT_BUY_COST: Record<string, number> = {
  "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9,
};

export type StatMethod =
  | { kind: "pointBuy"; budget: number; min: number; max: number; costTable: Record<string, number> }
  | { kind: "array"; values: number[] }
  | { kind: "rolled"; count: number; die: number; dropLowest: number; assignFreely: boolean }
  | { kind: "manual"; min: number; max: number };

export function statMethodSummary(m: StatMethod): string {
  switch (m.kind) {
    case "pointBuy": return `Point buy - ${m.budget} points, scores ${m.min}-${m.max}`;
    case "array": return `Standard array - assign ${m.values.join(", ")}`;
    case "rolled": return `Rolled - ${m.count}d${m.die}${m.dropLowest ? ` drop lowest ${m.dropLowest}` : ""} per stat${m.assignFreely ? ", assign freely" : ", in order"}`;
    case "manual": return `Manual entry - scores ${m.min}-${m.max}, DM reviews`;
  }
}

// --------------------------------- steps -----------------------------------

export interface ChoiceOption {
  id: string;
  name: string;
  description: string;
  /** Auto-applied to ability scores on approval, e.g. { dex: 2, int: 1 }. */
  statEffects?: Partial<Record<AbilityKey, number>>;
}

export interface TextPrompt {
  id: string;
  label: string;
  long: boolean;
  required: boolean;
  /** Where the answer lands on approval. */
  target: "name" | "summary" | "bio" | "personality" | "ideals" | "bonds" | "flaws" | "free";
}

export type BlueprintStep =
  | { id: string; kind: "stats"; title: string; method: StatMethod }
  | { id: string; kind: "choice"; title: string; prompt: string; sheetTarget: "race" | "class" | "background" | "none"; options: ChoiceOption[] }
  | { id: string; kind: "equipment"; title: string; goldBudget: number; maxItems: number; categories: string[] }
  | { id: string; kind: "spells"; title: string; maxSpells: number; maxLevel: number }
  | { id: string; kind: "text"; title: string; prompts: TextPrompt[] };

export interface Blueprint {
  enabled: boolean;
  steps: BlueprintStep[];
}

// ------------------------------ step answers -------------------------------

export type StepAnswer =
  | { kind: "stats"; scores: Record<AbilityKey, number>; rolled?: { pool: number[]; breakdowns: string[] } }
  | { kind: "choice"; optionId: string }
  | { kind: "equipment"; itemIds: string[] }
  | { kind: "spells"; spellIds: string[] }
  | { kind: "text"; values: Record<string, string> };

export interface DraftData {
  answers: Record<string, StepAnswer>;
}

// ------------------------------- validation --------------------------------

export function pointBuyTotal(scores: Record<AbilityKey, number>, costTable: Record<string, number>): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const c = costTable[String(scores[a])];
    if (c === undefined) return null; // score outside the table
    total += c;
  }
  return total;
}

/** Client+server validation for the steps that need no DB access.
 *  Equipment/spell budgets are enforced server-side in blueprint-queries. */
export function validateStatAnswer(method: StatMethod, answer: Extract<StepAnswer, { kind: "stats" }>): string | null {
  const scores = answer.scores;
  for (const a of ABILITIES) {
    const v = scores[a];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 30) return `${ABILITY_LABELS[a]} must be a whole number between 1 and 30.`;
  }
  switch (method.kind) {
    case "pointBuy": {
      for (const a of ABILITIES) {
        if (scores[a] < method.min || scores[a] > method.max) return `${ABILITY_LABELS[a]} must be between ${method.min} and ${method.max}.`;
      }
      const total = pointBuyTotal(scores, method.costTable);
      if (total === null) return "A score is outside the cost table.";
      if (total > method.budget) return `That spends ${total} points - the budget is ${method.budget}.`;
      return null;
    }
    case "array": {
      const want = [...method.values].sort((x, y) => x - y).join(",");
      const got = ABILITIES.map((a) => scores[a]).sort((x, y) => x - y).join(",");
      if (want !== got) return `Assign exactly the array values (${method.values.join(", ")}), each used once.`;
      return null;
    }
    case "rolled": {
      const pool = answer.rolled?.pool;
      if (!pool || pool.length !== ABILITIES.length) return "Roll your stats first.";
      const want = [...pool].sort((x, y) => x - y).join(",");
      const got = ABILITIES.map((a) => scores[a]).sort((x, y) => x - y).join(",");
      if (method.assignFreely) {
        if (want !== got) return "Assign exactly the rolled values, each used once.";
      } else {
        const inOrder = ABILITIES.map((a, i) => scores[a] === pool[i]).every(Boolean);
        if (!inOrder) return "This campaign assigns rolled stats in order - they can't be rearranged.";
      }
      return null;
    }
    case "manual": {
      for (const a of ABILITIES) {
        if (scores[a] < method.min || scores[a] > method.max) return `${ABILITY_LABELS[a]} must be between ${method.min} and ${method.max}.`;
      }
      return null;
    }
  }
}

export function validateTextAnswer(step: Extract<BlueprintStep, { kind: "text" }>, answer: Extract<StepAnswer, { kind: "text" }>): string | null {
  for (const p of step.prompts) {
    const v = (answer.values[p.id] ?? "").trim();
    if (p.required && !v) return `"${p.label}" is required.`;
    if (v.length > 20000) return `"${p.label}" is too long.`;
  }
  return null;
}

/** Server-side stat rolling for the "rolled" method - each stat is
 *  {count}d{die} keeping all but the lowest {dropLowest}; full per-die
 *  breakdowns are stored so nothing is hidden from the table. */
export function rollStatPool(method: Extract<StatMethod, { kind: "rolled" }>): { pool: number[]; breakdowns: string[] } {
  const pool: number[] = [];
  const breakdowns: string[] = [];
  for (let i = 0; i < ABILITIES.length; i++) {
    const dice = Array.from({ length: Math.min(Math.max(method.count, 1), 20) }, () => 1 + Math.floor(Math.random() * Math.max(method.die, 2)));
    const sorted = [...dice].sort((a, b) => a - b);
    const kept = sorted.slice(Math.min(method.dropLowest, dice.length - 1));
    const total = kept.reduce((s, d) => s + d, 0);
    pool.push(total);
    breakdowns.push(`${method.count}d${method.die}: [${dice.join(", ")}]${method.dropLowest ? ` drop ${sorted.slice(0, method.dropLowest).join(", ")}` : ""} = ${total}`);
  }
  return { pool, breakdowns };
}

export function newStepId(): string {
  return crypto.randomUUID();
}

// ------------------------- server-side sanitization ------------------------

const num = (v: unknown, fb: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fb;
};
const str = (v: unknown, fb = "") => (typeof v === "string" ? v.slice(0, 4000) : fb);

/** The editor posts steps as JSON - a claim, not a trusted value. Coerce
 *  every field into shape and drop anything unrecognizable. */
export function sanitizeBlueprintSteps(raw: unknown): BlueprintStep[] {
  if (!Array.isArray(raw)) return [];
  const out: BlueprintStep[] = [];
  for (const r of raw.slice(0, 30)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id.slice(0, 64) : newStepId();
    const title = str(o.title, "Step").slice(0, 120) || "Step";
    switch (o.kind) {
      case "stats": {
        const m = (o.method ?? {}) as Record<string, unknown>;
        let method: StatMethod;
        if (m.kind === "array") {
          const values = Array.isArray(m.values) ? m.values.slice(0, 6).map((v) => num(v, 10, 1, 30)) : [];
          while (values.length < 6) values.push(10);
          method = { kind: "array", values };
        } else if (m.kind === "rolled") {
          method = { kind: "rolled", count: num(m.count, 4, 1, 20), die: num(m.die, 6, 2, 100), dropLowest: num(m.dropLowest, 1, 0, 19), assignFreely: m.assignFreely !== false };
        } else if (m.kind === "manual") {
          method = { kind: "manual", min: num(m.min, 3, 1, 30), max: num(m.max, 18, 1, 30) };
        } else {
          const ct: Record<string, number> = {};
          const rawCt = (m.costTable ?? {}) as Record<string, unknown>;
          for (const k of Object.keys(rawCt).slice(0, 40)) {
            const score = num(k, NaN, 1, 30);
            if (Number.isFinite(score)) ct[String(score)] = num(rawCt[k], 0, 0, 100);
          }
          method = {
            kind: "pointBuy", budget: num(m.budget, 27, 0, 500),
            min: num(m.min, 8, 1, 30), max: num(m.max, 15, 1, 30),
            costTable: Object.keys(ct).length ? ct : { ...DEFAULT_POINT_BUY_COST },
          };
        }
        out.push({ id, kind: "stats", title, method });
        break;
      }
      case "choice": {
        const target = ["race", "class", "background", "none"].includes(o.sheetTarget as string) ? (o.sheetTarget as "race" | "class" | "background" | "none") : "none";
        const options: ChoiceOption[] = (Array.isArray(o.options) ? o.options.slice(0, 100) : [])
          .map((op) => {
            const oo = (op ?? {}) as Record<string, unknown>;
            const effects: Partial<Record<AbilityKey, number>> = {};
            const rawE = (oo.statEffects ?? {}) as Record<string, unknown>;
            for (const a of ABILITIES) if (rawE[a] !== undefined && Number(rawE[a]) !== 0) effects[a] = num(rawE[a], 0, -10, 10);
            return {
              id: typeof oo.id === "string" && oo.id ? oo.id.slice(0, 64) : newStepId(),
              name: str(oo.name).slice(0, 120),
              description: str(oo.description),
              ...(Object.keys(effects).length ? { statEffects: effects } : {}),
            };
          })
          .filter((op) => op.name);
        out.push({ id, kind: "choice", title, prompt: str(o.prompt).slice(0, 500), sheetTarget: target, options });
        break;
      }
      case "equipment":
        out.push({
          id, kind: "equipment", title,
          goldBudget: num(o.goldBudget, 100, 0, 1000000),
          maxItems: num(o.maxItems, 15, 1, 200),
          categories: (Array.isArray(o.categories) ? o.categories.slice(0, 20) : []).map((c) => str(c).slice(0, 60)).filter(Boolean),
        });
        break;
      case "spells":
        out.push({ id, kind: "spells", title, maxSpells: num(o.maxSpells, 4, 0, 100), maxLevel: num(o.maxLevel, 1, 0, 9) });
        break;
      case "text": {
        const prompts: TextPrompt[] = (Array.isArray(o.prompts) ? o.prompts.slice(0, 30) : [])
          .map((pr) => {
            const pp = (pr ?? {}) as Record<string, unknown>;
            const target = ["name", "summary", "bio", "personality", "ideals", "bonds", "flaws", "free"].includes(pp.target as string)
              ? (pp.target as TextPrompt["target"]) : "free";
            return {
              id: typeof pp.id === "string" && pp.id ? pp.id.slice(0, 64) : newStepId(),
              label: str(pp.label).slice(0, 120),
              long: !!pp.long,
              required: !!pp.required,
              target,
            };
          })
          .filter((pr) => pr.label);
        out.push({ id, kind: "text", title, prompts });
        break;
      }
    }
  }
  return out;
}

// ----------------------------- default 5e recipe ---------------------------

const SRD_RACES: [string, string, Partial<Record<AbilityKey, number>>][] = [
  ["Human", "Versatile and ambitious - +1 to every ability score.", { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }],
  ["Dwarf (Hill)", "Stout mountain folk with darkvision and poison resilience.", { con: 2, wis: 1 }],
  ["Elf (High)", "Graceful, keen-sensed, with a cantrip in the blood.", { dex: 2, int: 1 }],
  ["Halfling (Lightfoot)", "Small, lucky, and easy to overlook.", { dex: 2, cha: 1 }],
  ["Dragonborn", "Draconic heritage, breath weapon included.", { str: 2, cha: 1 }],
  ["Gnome (Rock)", "Small, clever, tinkering folk.", { int: 2, con: 1 }],
  ["Half-Elf", "Between two worlds, at home in neither.", { cha: 2, dex: 1, wis: 1 }],
  ["Half-Orc", "Relentless endurance and savage strength.", { str: 2, con: 1 }],
  ["Tiefling", "Infernal heritage, unearned suspicion.", { cha: 2, int: 1 }],
];

const SRD_CLASSES: [string, string][] = [
  ["Barbarian", "Rage-fueled warrior. d12 hit die."], ["Bard", "Magic through art and inspiration. d8."],
  ["Cleric", "Divine agent of a god. d8."], ["Druid", "Nature's shapeshifting keeper. d8."],
  ["Fighter", "Master of weapons and armor. d10."], ["Monk", "Martial artist of ki. d8."],
  ["Paladin", "Oath-bound holy warrior. d10."], ["Ranger", "Hunter of the wild borders. d10."],
  ["Rogue", "Precision, stealth, expertise. d8."], ["Sorcerer", "Innate magic. d6."],
  ["Warlock", "Pact magic from a patron. d8."], ["Wizard", "Learned arcane mastery. d6."],
];

export function defaultBlueprint(): Blueprint {
  return {
    enabled: false,
    steps: [
      { id: newStepId(), kind: "stats", title: "Ability Scores", method: { kind: "pointBuy", budget: 27, min: 8, max: 15, costTable: { ...DEFAULT_POINT_BUY_COST } } },
      {
        id: newStepId(), kind: "choice", title: "Race", prompt: "Choose your people.", sheetTarget: "race",
        options: SRD_RACES.map(([name, description, statEffects]) => ({ id: newStepId(), name, description, statEffects })),
      },
      {
        id: newStepId(), kind: "choice", title: "Class", prompt: "Choose your calling.", sheetTarget: "class",
        options: SRD_CLASSES.map(([name, description]) => ({ id: newStepId(), name, description })),
      },
      { id: newStepId(), kind: "equipment", title: "Starting Equipment", goldBudget: 100, maxItems: 15, categories: ["Weapon", "Armor", "Adventuring Gear", "Tools"] },
      { id: newStepId(), kind: "spells", title: "Spells", maxSpells: 4, maxLevel: 1 },
      {
        id: newStepId(), kind: "text", title: "Identity", prompts: [
          { id: newStepId(), label: "Character Name", long: false, required: true, target: "name" },
          { id: newStepId(), label: "One-line summary", long: false, required: false, target: "summary" },
          { id: newStepId(), label: "Backstory", long: true, required: false, target: "bio" },
          { id: newStepId(), label: "Personality Traits", long: true, required: false, target: "personality" },
          { id: newStepId(), label: "Ideals", long: false, required: false, target: "ideals" },
          { id: newStepId(), label: "Bonds", long: false, required: false, target: "bonds" },
          { id: newStepId(), label: "Flaws", long: false, required: false, target: "flaws" },
        ],
      },
    ],
  };
}
