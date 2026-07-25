import { createHash, randomBytes } from "node:crypto";
import { getDb, ensureSchema, newId } from "./db";
import type { ViewerContext } from "./player-session";

// ---------------------------------------------------------------------------
// Bearer-token auth for the JSON API (/api/v1) - the desktop Companion app's
// way in (2026-07-25). Cookie sessions can't serve a native client, so a
// player logs in once through POST /api/v1/auth/login and receives an opaque
// token to send as `Authorization: Bearer <token>` on every call.
//
// Only the SHA-256 digest of the token is stored (api_tokens.token_hash);
// the raw value exists exactly once, in the login response. Losing the
// device just means logging in again - and deleting the row (logout, or a
// future "manage devices" screen) revokes it instantly. Tokens cascade away
// with their player, so removing a player from a campaign also cuts off
// their app.
//
// SECURITY INVARIANT - same as the website: everything the API returns goes
// through the exact same query layer (queries.ts) with a ViewerContext built
// from the token's player row. Revealed-filtering, per-player entity access,
// and GM-tag resolution all happen server-side; unrevealed content never
// leaves the server, so the app's local cache can never leak a DM secret.
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = "ecx_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a new API token for a player and returns the RAW token - the only
 *  time it ever exists in plaintext. */
export async function issuePlayerToken(playerId: string, label?: string): Promise<string> {
  await ensureSchema();
  const raw = TOKEN_PREFIX + randomBytes(24).toString("hex");
  await getDb().execute({
    sql: "INSERT INTO api_tokens (id, player_id, token_hash, label) VALUES (?,?,?,?)",
    args: [newId(), playerId, hashToken(raw), label ?? null],
  });
  return raw;
}

/** Deletes the token row for this raw token (logout). Idempotent. */
export async function revokeToken(rawToken: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM api_tokens WHERE token_hash = ?",
    args: [hashToken(rawToken)],
  });
}

export interface ApiViewer {
  viewer: ViewerContext;
  /** The player's assigned character, if any - rolls and sheet access are
   *  scoped to this and nothing else. */
  characterId: string | null;
}

/** Pulls the bearer token off a request. Returns null when absent/malformed. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) return null;
  return m[1];
}

/** Resolves the viewer behind a request's bearer token - the API-side twin
 *  of getViewerContext(). Returns null for missing/unknown/orphaned tokens;
 *  callers turn that into a 401. */
export async function resolveApiViewer(req: Request): Promise<ApiViewer | null> {
  const raw = bearerToken(req);
  if (!raw) return null;
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT t.id AS token_id, t.last_used_at,
                 p.id AS player_id, p.username, p.display_name, p.campaign_id, p.character_id
          FROM api_tokens t JOIN players p ON p.id = t.player_id
          WHERE t.token_hash = ?`,
    args: [hashToken(raw)],
  });
  const row = r.rows[0];
  if (!row) return null;
  // Touch last_used_at at most hourly - it's a "which devices are active"
  // nicety, not worth a Turso write on every single request.
  const last = row.last_used_at as string | null;
  if (!last || last < isoAnHourAgo()) {
    await db.execute({
      sql: "UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?",
      args: [row.token_id],
    });
  }
  return {
    viewer: {
      playerId: row.player_id as string,
      username: row.username as string,
      displayName: (row.display_name as string) ?? null,
      campaignId: (row.campaign_id as string) ?? null,
    },
    characterId: (row.character_id as string) ?? null,
  };
}

function isoAnHourAgo(): string {
  // Matches SQLite's datetime('now') text format (UTC, "YYYY-MM-DD HH:MM:SS")
  // closely enough for a string comparison.
  return new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}
