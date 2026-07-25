import { resolveApiViewer } from "@/lib/api-auth";
import { getDb, ensureSchema } from "@/lib/db";
import { getCharacterSheet, patchLiveSheet, type LiveSheetPatch } from "@/lib/character-sheet";
import { json, apiError, unauthorized, corsPreflight, readJson } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/sheet - the viewer's own character sheet (merged to the full
// current shape, same as the website's sheet pages).
// PATCH /api/v1/sheet - a live combat patch (HP / death saves / spell slot /
// long rest), reusing patchLiveSheet() with its clamping intact.
//
// Ownership needs no extra check here: the character id comes off the
// token's player row inside resolveApiViewer, never from the request body -
// there is nothing a tampered client could substitute.

async function ownCharacter(playerId: string | null) {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT c.id, c.name, c.portrait_path FROM players p
          JOIN characters c ON c.id = p.character_id WHERE p.id = ?`,
    args: [playerId],
  });
  return r.rows[0] ?? null;
}

export async function GET(req: Request) {
  const auth = await resolveApiViewer(req);
  if (!auth) return unauthorized();
  const ch = await ownCharacter(auth.viewer.playerId);
  if (!ch) return apiError(404, "No character is assigned to you yet.");
  const sheet = await getCharacterSheet(ch.id as string);
  return json({
    characterId: ch.id as string,
    characterName: ch.name as string,
    portraitPath: (ch.portrait_path as string) ?? null,
    sheet,
  });
}

export async function PATCH(req: Request) {
  const auth = await resolveApiViewer(req);
  if (!auth) return unauthorized();
  const ch = await ownCharacter(auth.viewer.playerId);
  if (!ch) return apiError(404, "No character is assigned to you yet.");

  const body = await readJson(req);
  const patch = sanitizePatch(body?.patch);
  if (!patch) return apiError(400, "Unknown or malformed live patch.");

  const live = await patchLiveSheet(ch.id as string, patch);
  return json({ live });
}

/** Narrows arbitrary JSON down to a well-formed LiveSheetPatch (numbers
 *  coerced and finite, kinds whitelisted) - patchLiveSheet then clamps the
 *  values themselves. Returns null for anything else. */
function sanitizePatch(raw: any): LiveSheetPatch | null {
  if (!raw || typeof raw !== "object" || typeof raw.kind !== "string") return null;
  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  switch (raw.kind) {
    case "hp": {
      const current = num(raw.current);
      const temp = num(raw.temp);
      if (current === undefined && temp === undefined) return null;
      return { kind: "hp", current, temp };
    }
    case "deathSaves": {
      const successes = num(raw.successes);
      const failures = num(raw.failures);
      if (successes === undefined && failures === undefined) return null;
      return { kind: "deathSaves", successes, failures };
    }
    case "slot": {
      const used = num(raw.used);
      if (typeof raw.level !== "string" || used === undefined) return null;
      return { kind: "slot", level: raw.level, used };
    }
    case "longRest":
      return { kind: "longRest" };
    default:
      return null;
  }
}

export function OPTIONS() {
  return corsPreflight();
}
