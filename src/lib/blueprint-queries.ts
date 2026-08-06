import { getDb, ensureSchema, newId } from "./db";
import {
  type Blueprint, type BlueprintStep, type StepAnswer, type DraftData, type AbilityKey,
  ABILITIES, defaultBlueprint, validateStatAnswer, validateTextAnswer, rollStatPool,
} from "./blueprint-shared";
import { defaultCharacterSheet, newWeaponRolls } from "./character-sheet-shared";
import { saveCharacterSheet } from "./character-sheet";
import type { CharacterSheetData } from "./types";

// ---------------------------------------------------------------------------
// Blueprint + draft persistence, server-side validation for the steps that
// need the database (equipment budgets, spell lists), and the approval
// ceremony that turns a submitted draft into a real character + sheet.
// ---------------------------------------------------------------------------

export interface StoredBlueprint extends Blueprint {
  /** True when the campaign has never saved one - the DM is seeing the seeded 5e default. */
  isDefault: boolean;
}

export async function getBlueprint(campaignId: string): Promise<StoredBlueprint> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT enabled, steps FROM creation_blueprints WHERE campaign_id = ?", args: [campaignId] });
  const row = r.rows[0];
  if (!row) return { ...defaultBlueprint(), isDefault: true };
  let steps: BlueprintStep[] = [];
  try { steps = JSON.parse((row.steps as string) || "[]"); } catch { steps = []; }
  return { enabled: !!Number(row.enabled), steps, isDefault: false };
}

export async function saveBlueprint(campaignId: string, bp: Blueprint): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({ sql: "SELECT id FROM creation_blueprints WHERE campaign_id = ?", args: [campaignId] });
  const stepsJson = JSON.stringify(bp.steps);
  if (existing.rows[0]) {
    await db.execute({
      sql: "UPDATE creation_blueprints SET enabled=?, steps=?, updated_at=datetime('now') WHERE campaign_id=?",
      args: [bp.enabled ? 1 : 0, stepsJson, campaignId],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO creation_blueprints (id, campaign_id, enabled, steps) VALUES (?,?,?,?)",
      args: [newId(), campaignId, bp.enabled ? 1 : 0, stepsJson],
    });
  }
}

// --------------------------------- drafts ----------------------------------

export interface Draft {
  id: string;
  campaignId: string;
  playerId: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  data: DraftData;
  dmNote: string | null;
  characterId: string | null;
}

function rowToDraft(row: Record<string, unknown>): Draft {
  let data: DraftData = { answers: {} };
  try {
    const parsed = JSON.parse((row.data as string) || "{}");
    if (parsed && typeof parsed === "object") data = { answers: parsed.answers ?? {} };
  } catch { /* keep empty */ }
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    playerId: row.player_id as string,
    status: row.status as Draft["status"],
    data,
    dmNote: (row.dm_note as string) ?? null,
    characterId: (row.character_id as string) ?? null,
  };
}

export async function getDraftForPlayer(playerId: string): Promise<Draft | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM character_drafts WHERE player_id = ?", args: [playerId] });
  return r.rows[0] ? rowToDraft(r.rows[0]) : null;
}

async function requireEditableDraft(playerId: string, campaignId: string): Promise<Draft> {
  let draft = await getDraftForPlayer(playerId);
  // A player moved to another campaign since drafting: the old answers
  // reference another blueprint's steps - restart cleanly in the new home.
  if (draft && draft.campaignId !== campaignId && draft.status !== "approved") {
    await getDb().execute({
      sql: `UPDATE character_drafts SET campaign_id=?, status='draft', data='{"answers":{}}', dm_note=NULL, updated_at=datetime('now') WHERE id=?`,
      args: [campaignId, draft.id],
    });
    draft = await getDraftForPlayer(playerId);
  }
  if (!draft) {
    const id = newId();
    await getDb().execute({
      sql: "INSERT INTO character_drafts (id, campaign_id, player_id, status, data) VALUES (?,?,?,'draft','{\"answers\":{}}')",
      args: [id, campaignId, playerId],
    });
    draft = (await getDraftForPlayer(playerId))!;
  }
  if (draft.status === "rejected") {
    // touching a rejected draft reopens it
    await getDb().execute({ sql: "UPDATE character_drafts SET status='draft', updated_at=datetime('now') WHERE id=?", args: [draft.id] });
    draft.status = "draft";
  }
  if (draft.status !== "draft") throw new Error("This draft is locked (submitted or approved).");
  return draft;
}

async function persistAnswer(draft: Draft, stepId: string, answer: StepAnswer): Promise<void> {
  draft.data.answers[stepId] = answer;
  await getDb().execute({
    sql: "UPDATE character_drafts SET data=?, updated_at=datetime('now') WHERE id=?",
    args: [JSON.stringify(draft.data), draft.id],
  });
}

/** Cost strings like "15 gp" / "5 sp" / "2 cp" -> gold. Unpriced items cost 0. */
function goldValue(cost: string | null): number {
  if (!cost) return 0;
  const m = cost.trim().match(/^([\d.]+)\s*(pp|gp|ep|sp|cp)$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const mult = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 }[m[2].toLowerCase() as "pp" | "gp" | "ep" | "sp" | "cp"];
  return n * mult;
}

export interface AnswerResult { ok: boolean; error?: string }

/** Validate + save one step's answer. Equipment/spell steps hit the library
 *  tables here; the rest reuse the shared validators. */
export async function answerStep(playerId: string, campaignId: string, step: BlueprintStep, answer: StepAnswer): Promise<AnswerResult> {
  await ensureSchema();
  const draft = await requireEditableDraft(playerId, campaignId);
  if (answer.kind !== step.kind) return { ok: false, error: "Answer does not match the step." };

  if (step.kind === "stats" && answer.kind === "stats") {
    // preserve a previously rolled pool - the client never supplies it
    const prev = draft.data.answers[step.id];
    if (step.method.kind === "rolled") {
      const pool = prev?.kind === "stats" ? prev.rolled : undefined;
      if (!pool) return { ok: false, error: "Roll your stats first." };
      answer = { ...answer, rolled: pool };
    }
    const err = validateStatAnswer(step.method, answer);
    if (err) return { ok: false, error: err };
  } else if (step.kind === "choice" && answer.kind === "choice") {
    const chosen = answer.optionId;
    if (!step.options.some((o) => o.id === chosen)) return { ok: false, error: "Pick one of the listed options." };
  } else if (step.kind === "text" && answer.kind === "text") {
    const err = validateTextAnswer(step, answer);
    if (err) return { ok: false, error: err };
  } else if (step.kind === "equipment" && answer.kind === "equipment") {
    const ids = [...new Set(answer.itemIds)];
    if (ids.length > step.maxItems) return { ok: false, error: `At most ${step.maxItems} items.` };
    if (ids.length > 0) {
      const qs = ids.map(() => "?").join(",");
      const r = await getDb().execute({
        sql: `SELECT id, category, cost FROM equipment_items WHERE campaign_id IS NULL AND id IN (${qs})`,
        args: ids,
      });
      if (r.rows.length !== ids.length) return { ok: false, error: "An item no longer exists in the library." };
      for (const row of r.rows) {
        if (step.categories.length && !step.categories.includes((row.category as string) ?? "")) {
          return { ok: false, error: "An item is outside this campaign's allowed categories." };
        }
      }
      const unpriced = r.rows.find((row) => goldValue(row.cost as string | null) === 0 && !/^0/.test(String(row.cost ?? "")));
      if (unpriced) {
        const nm = await getDb().execute({ sql: "SELECT name FROM equipment_items WHERE id = ?", args: [unpriced.id as string] });
        return { ok: false, error: `"${(nm.rows[0]?.name as string) ?? "An item"}" has no listed price and can't be taken with starting gold - ask your DM to grant it directly.` };
      }
      const total = r.rows.reduce((s, row) => s + goldValue(row.cost as string | null), 0);
      if (total > step.goldBudget) return { ok: false, error: `That costs ${total.toFixed(1)} gp - the budget is ${step.goldBudget} gp.` };
    }
    answer = { kind: "equipment", itemIds: ids };
  } else if (step.kind === "spells" && answer.kind === "spells") {
    const ids = [...new Set(answer.spellIds)];
    if (ids.length > step.maxSpells) return { ok: false, error: `At most ${step.maxSpells} spells.` };
    if (ids.length > 0) {
      const qs = ids.map(() => "?").join(",");
      const r = await getDb().execute({
        sql: `SELECT id, level FROM spells WHERE campaign_id IS NULL AND id IN (${qs})`,
        args: ids,
      });
      if (r.rows.length !== ids.length) return { ok: false, error: "A spell no longer exists in the library." };
      for (const row of r.rows) {
        if (Number(row.level) > step.maxLevel) return { ok: false, error: `Spells above level ${step.maxLevel} aren't allowed.` };
      }
    }
    answer = { kind: "spells", spellIds: ids };
  } else {
    return { ok: false, error: "Unknown step." };
  }

  await persistAnswer(draft, step.id, answer);
  return { ok: true };
}

/** Roll (or re-roll) the stat pool for a rolled-method step - server-side
 *  dice, full breakdown stored. Only while the draft is editable. */
export async function rollStatsForStep(playerId: string, campaignId: string, step: Extract<BlueprintStep, { kind: "stats" }>): Promise<AnswerResult> {
  if (step.method.kind !== "rolled") return { ok: false, error: "This campaign doesn't roll stats." };
  const draft = await requireEditableDraft(playerId, campaignId);
  const rolled = rollStatPool(step.method);
  const scores = Object.fromEntries(ABILITIES.map((a, i) => [a, rolled.pool[i]])) as Record<AbilityKey, number>;
  await persistAnswer(draft, step.id, { kind: "stats", scores, rolled });
  return { ok: true };
}

export async function submitDraft(playerId: string, campaignId: string, steps: BlueprintStep[]): Promise<AnswerResult> {
  const draft = await requireEditableDraft(playerId, campaignId);
  for (const step of steps) {
    const a = draft.data.answers[step.id];
    if (!a) return { ok: false, error: `"${step.title}" isn't finished yet.` };
  }
  await getDb().execute({ sql: "UPDATE character_drafts SET status='submitted', dm_note=NULL, updated_at=datetime('now') WHERE id=?", args: [draft.id] });
  return { ok: true };
}

// ------------------------------ DM inbox side ------------------------------

export interface DraftListing extends Draft {
  playerName: string;
  username: string;
}

export async function listDraftsForCampaign(campaignId: string): Promise<DraftListing[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT d.*, p.display_name AS player_name, p.username FROM character_drafts d
          JOIN players p ON p.id = d.player_id WHERE d.campaign_id = ? ORDER BY d.updated_at DESC`,
    args: [campaignId],
  });
  return r.rows.map((row) => ({ ...rowToDraft(row), playerName: (row.player_name as string) ?? "", username: (row.username as string) ?? "" }));
}

export async function rejectDraft(campaignId: string, draftId: string, note: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE character_drafts SET status='rejected', dm_note=?, updated_at=datetime('now') WHERE id=? AND campaign_id=? AND status='submitted'",
    args: [note || null, draftId, campaignId],
  });
}

async function uniqueCharacterSlug(campaignId: string, name: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "character";
  const db = getDb();
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM characters WHERE campaign_id = ? AND slug = ?", args: [campaignId, slug] });
    if (!r.rows[0]) return slug;
    slug = `${base}-${n++}`;
  }
}

/** The approval ceremony: submitted draft -> unrevealed PC + populated sheet,
 *  player linked. Returns the new character id. */
export async function approveDraft(campaignId: string, draftId: string, steps: BlueprintStep[]): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({ sql: "SELECT * FROM character_drafts WHERE id = ? AND campaign_id = ? AND status = 'submitted'", args: [draftId, campaignId] });
  if (!r.rows[0]) throw new Error("Draft not found or not awaiting approval.");
  const draft = rowToDraft(r.rows[0]);
  const playerRow = await db.execute({ sql: "SELECT campaign_id FROM players WHERE id = ?", args: [draft.playerId] });
  if ((playerRow.rows[0]?.campaign_id ?? null) !== campaignId) {
    throw new Error("This player has moved to another campaign - the draft is stale and can't be approved here.");
  }

  const sheet: CharacterSheetData = defaultCharacterSheet();
  let name = "", summary = "", bio = "", race = "", charClass = "";
  let gpSpent = 0;

  for (const step of steps) {
    const a = draft.data.answers[step.id];
    if (!a) continue;
    if (step.kind === "stats" && a.kind === "stats") {
      sheet.abilityScores = { ...a.scores };
    } else if (step.kind === "choice" && a.kind === "choice") {
      const opt = step.options.find((o) => o.id === a.optionId);
      if (!opt) continue;
      if (opt.statEffects) {
        for (const key of Object.keys(opt.statEffects) as AbilityKey[]) {
          sheet.abilityScores[key] = Math.min(30, sheet.abilityScores[key] + (opt.statEffects[key] ?? 0));
        }
      }
      if (step.sheetTarget === "race") { sheet.race = opt.name; race = opt.name; }
      else if (step.sheetTarget === "class") { sheet.classLevel = `${opt.name} 1`; sheet.spellcastingClass = opt.name; charClass = opt.name; }
      else if (step.sheetTarget === "background") sheet.background = opt.name;
    } else if (step.kind === "equipment" && a.kind === "equipment" && a.itemIds.length) {
      const qs = a.itemIds.map(() => "?").join(",");
      const items = await db.execute({ sql: `SELECT * FROM equipment_items WHERE campaign_id IS NULL AND id IN (${qs})`, args: a.itemIds });
      const lines: string[] = [];
      for (const row of items.rows) {
        let statLine = "";
        try { statLine = (JSON.parse((row.details as string) || "{}").statLine as string) ?? ""; } catch { /* ignore */ }
        lines.push(`${row.name}${row.cost ? ` (${row.cost})` : ""}${statLine ? ` - ${statLine}` : ""}`);
        gpSpent += goldValue(row.cost as string | null);
        if ((row.category as string) === "Weapon") {
          sheet.attacks.push({ id: crypto.randomUUID(), name: row.name as string, description: statLine, rolls: newWeaponRolls() });
        }
      }
      sheet.equipment = lines.join("\n");
      const budget = step.goldBudget;
      sheet.currency.gp = Math.max(0, Math.round((budget - gpSpent) * 10) / 10);
    } else if (step.kind === "spells" && a.kind === "spells" && a.spellIds.length) {
      const qs = a.spellIds.map(() => "?").join(",");
      const rows = await db.execute({ sql: `SELECT * FROM spells WHERE campaign_id IS NULL AND id IN (${qs}) ORDER BY level, name`, args: a.spellIds });
      for (const row of rows.rows) {
        let description = "";
        try {
          const d = JSON.parse((row.details as string) || "{}");
          description = [d.castingTime && `Casting: ${d.castingTime}`, d.range && `Range: ${d.range}`, d.duration && `Duration: ${d.duration}`, d.description]
            .filter(Boolean).join("\n");
        } catch { /* ignore */ }
        sheet.spells.push({ id: crypto.randomUUID(), level: Number(row.level ?? 0), name: row.name as string, prepared: true, description, rolls: [] });
      }
    } else if (step.kind === "text" && a.kind === "text") {
      const free: string[] = [];
      for (const p of step.prompts) {
        const v = (a.values[p.id] ?? "").trim();
        if (!v) continue;
        if (p.target === "name") name = v;
        else if (p.target === "summary") summary = v;
        else if (p.target === "bio") bio = v;
        else if (p.target === "personality") sheet.personalityTraits = v;
        else if (p.target === "ideals") sheet.ideals = v;
        else if (p.target === "bonds") sheet.bonds = v;
        else if (p.target === "flaws") sheet.flaws = v;
        else free.push(`${p.label}: ${v}`);
      }
      if (free.length) sheet.featuresTraits = [sheet.featuresTraits, ...free].filter(Boolean).join("\n\n");
    }
  }

  if (!name) throw new Error("The draft has no character name.");
  const charId = newId();
  const slug = await uniqueCharacterSlug(campaignId, name);
  await db.execute({
    sql: `INSERT INTO characters (id, campaign_id, slug, name, is_pc, is_alive, race, char_class, status, summary, bio, tags, portrait_path, revealed, location_id, mask)
          VALUES (?,?,?,?,1,1,?,?,?,?,?,?,NULL,0,NULL,NULL)`,
    args: [charId, campaignId, slug, name, race || null, charClass || null, "Alive", summary, bio, null],
  });
  await saveCharacterSheet(charId, sheet);
  await db.batch(
    [
      { sql: "UPDATE players SET character_id=?, updated_at=datetime('now') WHERE id=?", args: [charId, draft.playerId] },
      { sql: "UPDATE character_drafts SET status='approved', character_id=?, updated_at=datetime('now') WHERE id=?", args: [charId, draft.id] },
    ],
    "write"
  );
  return charId;
}
