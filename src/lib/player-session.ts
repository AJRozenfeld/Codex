import { cache } from "react";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { sessionOptions as adminSessionOptions } from "./auth";
import { getDb, ensureSchema } from "./db";

// ---------------------------------------------------------------------------
// Player session - completely separate cookie/session from the admin one in
// auth.ts, so logging in as a player never grants admin access and vice
// versa. Reuses the same SESSION_SECRET (fine - iron-session keys sessions
// by cookie name, not by secret).
// ---------------------------------------------------------------------------

export interface PlayerSessionData {
  playerId?: string;
}

export const playerSessionOptions: SessionOptions = {
  ...adminSessionOptions,
  cookieName: "erendyl_player_session",
};

export async function getPlayerSession() {
  return getIronSession<PlayerSessionData>(await cookies(), playerSessionOptions);
}

export async function getCurrentPlayerId(): Promise<string | null> {
  const session = await getPlayerSession();
  return session.playerId ?? null;
}

export interface ViewerContext {
  playerId: string | null;
  username: string | null;
  /** Human-facing name for the header greeting - fetched in the same single
   *  players query as username/campaignId so NavBar doesn't need its own
   *  round trip (it used to run an identical SELECT of its own). */
  displayName: string | null;
  // Which campaign this player belongs to - every public query.ts function
  // filters on this. A null campaignId (anonymous) naturally matches zero
  // rows in a `campaign_id = ?` clause, so unauthenticated viewers see
  // nothing even if a query is somehow reached without going through
  // middleware.ts's site-wide login gate.
  campaignId: string | null;
}

// The single source of "who is looking at this page right now" used by the
// public query layer to decide entity-level restriction, campaign scoping,
// and to resolve <GM approved="..."> tags. Anonymous visitors get
// { null, null, null, null }, which never matches anything - restricted
// entities, GM-tagged spans, and every campaign-scoped row stay hidden by
// default.
//
// PERFORMANCE: wrapped in React's cache() so the players-table lookup runs
// at most ONCE per request no matter how many times it's awaited - NavBar
// (rendered in the root layout) and every page both call this, which used
// to mean two identical round trips to Turso on every single page view.
export const getViewerContext = cache(async (): Promise<ViewerContext> => {
  const playerId = await getCurrentPlayerId();
  if (!playerId) return { playerId: null, username: null, displayName: null, campaignId: null };
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT username, display_name, campaign_id FROM players WHERE id = ?",
    args: [playerId],
  });
  const row = r.rows[0];
  const username = row ? (row.username as string) : null;
  const displayName = row ? ((row.display_name as string) ?? null) : null;
  const campaignId = row ? (row.campaign_id as string) : null;
  return { playerId, username, displayName, campaignId };
});
