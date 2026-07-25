import { getDmBySlug, playerLogin } from "@/lib/dm-queries";
import { LEGACY_DM_ID, getDb, ensureSchema } from "@/lib/db";
import { issuePlayerToken } from "@/lib/api-auth";
import { json, apiError, corsPreflight, readJson } from "../../_lib/http";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/login  { dmSlug?, username, password, deviceLabel? }
//
// The API twin of /login/<dmSlug>: same playerLogin() credential check, same
// founder fallback when no slug is given (matching the bare /login page), but
// instead of setting a session cookie it mints a bearer token for the
// desktop app. One generic error for every failure mode - no oracle.
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return apiError(400, "username and password are required.");
  }
  const dmSlug = typeof body.dmSlug === "string" && body.dmSlug.trim() ? body.dmSlug.trim() : null;

  let dmId: string;
  let dmName: string | null = null;
  if (dmSlug) {
    const dm = await getDmBySlug(dmSlug);
    if (!dm || !dm.isActive) return apiError(401, "Login failed. Check your table link, username and password.");
    dmId = dm.id;
    dmName = dm.name;
  } else {
    dmId = LEGACY_DM_ID;
  }

  const playerId = await playerLogin(dmId, body.username, body.password);
  if (!playerId) return apiError(401, "Login failed. Check your table link, username and password.");

  const label = typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : "Companion app";
  const token = await issuePlayerToken(playerId, label);

  // One round trip for everything the app wants to greet the player with.
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.username, p.display_name, p.campaign_id, p.character_id,
                 c.name AS campaign_name, c.show_moons
          FROM players p LEFT JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.id = ?`,
    args: [playerId],
  });
  const row = r.rows[0];

  return json({
    token,
    player: {
      id: playerId,
      username: (row?.username as string) ?? body.username,
      displayName: (row?.display_name as string) ?? null,
    },
    campaign: row?.campaign_id
      ? { id: row.campaign_id as string, name: (row.campaign_name as string) ?? null, showMoons: !!row.show_moons }
      : null,
    characterId: (row?.character_id as string) ?? null,
    dm: dmSlug ? { slug: dmSlug, name: dmName } : null,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
