import { resolveApiViewer } from "@/lib/api-auth";
import { requestSheetRoll } from "@/lib/roll-requests";
import { json, apiError, unauthorized, corsPreflight, readJson } from "../_lib/http";

export const dynamic = "force-dynamic";

// POST /api/v1/roll  { target } - drop a roll request onto the Discord
// bridge for the viewer's own character. Exactly the website d20 buttons'
// server action, minus the cookie: the character id comes off the token's
// player row (ownership by construction), and requestSheetRoll() keeps all
// of its own validation - target whitelist, saved-sheet action lookup,
// guild-link requirement, 5s dedupe.
export async function POST(req: Request) {
  const auth = await resolveApiViewer(req);
  if (!auth) return unauthorized();
  if (!auth.characterId) return apiError(404, "No character is assigned to you yet.");

  const body = await readJson(req);
  if (!body || typeof body.target !== "string" || !body.target.trim()) {
    return apiError(400, "A roll target is required.");
  }

  const result = await requestSheetRoll(auth.characterId, body.target);
  return json(result, result.ok ? 200 : 422);
}

export function OPTIONS() {
  return corsPreflight();
}
