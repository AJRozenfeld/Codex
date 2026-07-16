import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

// ---------------------------------------------------------------------------
// Admin auth: a single shared password (set via ADMIN_PASSWORD env var),
// gating /admin behind an encrypted session cookie. No user accounts —
// this is a one-DM tool, not a multi-user system.
//
// currentCampaignId tracks which campaign the DM is currently working in -
// set via the campaign switcher in the admin layout, read by every admin
// query so all reads/writes stay scoped to the selected campaign. The
// getCurrentCampaignId()/setCurrentCampaignId() helpers that touch the
// database live in campaign-queries.ts, not here - this file must stay
// free of any db.ts import, because middleware.ts (which runs in the Edge
// runtime, no Node "fs"/"path") imports auth.ts for session verification.
// Pulling db.ts in here would break the Edge build.
// ---------------------------------------------------------------------------

export interface AdminSessionData {
  isAdmin?: boolean;
  /** Which DM account (license) this admin session belongs to - set at
   *  login (2026-07-16). Sessions created before multi-tenancy lack it and
   *  are treated as the founder account (see getCurrentDmId). */
  dmId?: string;
  currentCampaignId?: string;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Fallback for local dev only — DEPLOYMENT.md instructs setting a real
    // secret in production. 32+ chars required by iron-session.
    return "erendyl-codex-dev-only-secret-please-change-me!!";
  }
  return secret;
}

export const sessionOptions: SessionOptions = {
  cookieName: "erendyl_admin_session",
  password: sessionSecret(),
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getAdminSession() {
  return getIronSession<AdminSessionData>(await cookies(), sessionOptions);
}

export async function isAdminAuthed(): Promise<boolean> {
  const session = await getAdminSession();
  return Boolean(session.isAdmin);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "erendyl";
  return input === expected;
}

// ---------------------------------------------------------------------------
// Master (license-issuer) auth - a completely separate cookie/session from
// both the DM admin session and the player session, gating /master. Only
// Aviv holds MASTER_PASSWORD; DMs never see this area. Kept edge-safe (no
// db.ts import) for the same middleware reason as everything else here.
// ---------------------------------------------------------------------------

export interface MasterSessionData {
  isMaster?: boolean;
}

export const masterSessionOptions: SessionOptions = {
  ...sessionOptions,
  cookieName: "erendyl_master_session",
};

export async function getMasterSession() {
  return getIronSession<MasterSessionData>(await cookies(), masterSessionOptions);
}

export async function isMasterAuthed(): Promise<boolean> {
  const session = await getMasterSession();
  return Boolean(session.isMaster);
}

export function checkMasterPassword(input: string): boolean {
  const expected = process.env.MASTER_PASSWORD ?? "erendyl-master";
  return input === expected;
}
