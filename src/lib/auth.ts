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
