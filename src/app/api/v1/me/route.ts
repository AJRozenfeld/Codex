import { resolveApiViewer } from "@/lib/api-auth";
import { getDb, ensureSchema } from "@/lib/db";
import { json, unauthorized, corsPreflight } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/me - who am I, what campaign am I in, which character is mine.
// The app calls this on launch to validate its stored token and refresh the
// player's assignment (a player can be moved between campaigns by their DM).
export async function GET(req: Request) {
  const auth = await resolveApiViewer(req);
  if (!auth) return unauthorized();

  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT p.username, p.display_name, p.campaign_id, p.character_id,
                 c.name AS campaign_name, c.show_moons,
                 ch.name AS character_name, ch.slug AS character_slug, ch.portrait_path
          FROM players p
          LEFT JOIN campaigns c ON c.id = p.campaign_id
          LEFT JOIN characters ch ON ch.id = p.character_id
          WHERE p.id = ?`,
    args: [auth.viewer.playerId],
  });
  const row = r.rows[0];
  if (!row) return unauthorized();

  return json({
    player: {
      id: auth.viewer.playerId,
      username: row.username as string,
      displayName: (row.display_name as string) ?? null,
    },
    campaign: row.campaign_id
      ? { id: row.campaign_id as string, name: (row.campaign_name as string) ?? null, showMoons: !!row.show_moons }
      : null,
    character: row.character_id
      ? {
          id: row.character_id as string,
          name: (row.character_name as string) ?? null,
          slug: (row.character_slug as string) ?? null,
          portraitPath: (row.portrait_path as string) ?? null,
        }
      : null,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
