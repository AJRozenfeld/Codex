import { getDb, ensureSchema, newId } from "./db";
import { SKILL_ABILITY } from "./character-sheet-shared";

// ---------------------------------------------------------------------------
// Website -> Discord roll bridge (2026-07-16). The d20 buttons on character
// sheets call requestSheetRoll(), which drops a row into roll_requests; the
// bot (discord-bot/src/rollQueue.ts) polls that table every ~1.5s and
// executes the roll in the campaign's linked guild - the exact same
// computation a "[[mask]]: *roll strength*" message runs, sheet modifiers
// and all.
//
// Why a queue through the shared database instead of calling the bot
// directly: the website runs on serverless (no long-lived connections) and
// the bot already shares this Turso database - no new endpoints, no new
// secrets, and if the bot is briefly down the request simply expires
// instead of erroring the sheet. Latency is one poll interval, fine for a
// tabletop rhythm. The upgrade path (an HTTP push to the Railway process)
// slots in behind this same function without touching any caller.
//
// OWNERSHIP IS THE CALLER'S JOB: this module verifies the target and the
// guild link, but the page-level server action must verify the viewer may
// roll for this character (player owns it / DM owns the campaign) BEFORE
// calling - see /me/sheet and /admin/characters/[id]/sheet.
// ---------------------------------------------------------------------------

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** Everything a d20 button may request today: the six ability checks and
 *  the eighteen skills - the same set the bot's *roll x* trigger accepts.
 *  Attacks/spells with multi-roll definitions come next (see IDEA_BOARD). */
export const ROLLABLE_TARGETS: ReadonlySet<string> = new Set([
  ...ABILITY_KEYS,
  ...Object.keys(SKILL_ABILITY),
]);

export async function requestSheetRoll(
  characterId: string,
  target: string
): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const trimmed = target.trim();
  let normalized: string;
  const actionKind = trimmed.startsWith("spell:") ? "spells" : trimmed.startsWith("attack:") ? "attacks" : null;
  if (actionKind) {
    // Action Creator (2026-07-19/20): "spell:<id>" / "attack:<id>" target an
    // entry on the character's sheet - validated against the SAVED sheet
    // right now so a stale/forged id fails here, not in the bot.
    normalized = trimmed;
    const noun = actionKind === "spells" ? "spell" : "weapon";
    const entries = await loadSheetActions(characterId, actionKind);
    const prefix = actionKind === "spells" ? "spell:" : "attack:";
    const entry = entries.find((e) => `${prefix}${e.id}` === trimmed);
    if (!entry) return { ok: false, error: `That ${noun} no longer exists on this sheet - save the sheet and try again.` };
    if (!Array.isArray(entry.rolls) || entry.rolls.length === 0) {
      return { ok: false, error: `This ${noun} has no rolls defined.` };
    }
  } else {
    normalized = trimmed.toLowerCase();
    if (!ROLLABLE_TARGETS.has(normalized)) return { ok: false, error: "Unknown roll target." };
  }

  const db = getDb();
  const ch = await db.execute({ sql: "SELECT campaign_id, name FROM characters WHERE id = ?", args: [characterId] });
  if (!ch.rows[0]) return { ok: false, error: "Character not found." };
  const campaignId = ch.rows[0].campaign_id as string;

  const guild = await db.execute({
    sql: "SELECT guild_id FROM guild_links WHERE campaign_id = ? LIMIT 1",
    args: [campaignId],
  });
  if (!guild.rows[0]) {
    return { ok: false, error: "No Discord server is linked to this campaign yet (DM: Admin → Discord)." };
  }

  // Double-click / impatient-finger guard: an identical pending request from
  // the last few seconds means the die is already in the air.
  const dup = await db.execute({
    sql: `SELECT id FROM roll_requests WHERE character_id = ? AND roll_target = ? AND status = 'pending'
          AND created_at > datetime('now', '-5 seconds')`,
    args: [characterId, normalized],
  });
  if (dup.rows[0]) return { ok: true };

  await db.execute({
    sql: "INSERT INTO roll_requests (id, campaign_id, character_id, roll_target) VALUES (?,?,?,?)",
    args: [newId(), campaignId, characterId, normalized],
  });
  return { ok: true };
}

/** The character's saved spell or weapon entries, raw from the sheet blob
 *  (no merge - unsaved client-side edits are invisible here by design:
 *  rolling requires a saved sheet). */
async function loadSheetActions(
  characterId: string,
  key: "spells" | "attacks"
): Promise<{ id?: string; rolls?: unknown[] }[]> {
  const r = await getDb().execute({
    sql: "SELECT data FROM character_sheets WHERE character_id = ?",
    args: [characterId],
  });
  if (!r.rows[0]) return [];
  try {
    const data = JSON.parse(r.rows[0].data as string);
    return Array.isArray(data[key]) ? data[key] : [];
  } catch {
    return [];
  }
}
