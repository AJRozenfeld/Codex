import { getDb, ensureSchema } from "./db";

// ---------------------------------------------------------------------------
// Login rate limiting (2026-07-31). Two keys guard every login attempt:
//  - an ACCOUNT key (surface + identifier): 5 failures in 15 min locks that
//    account's logins for 15 min - stops targeted brute force.
//  - an IP key: 30 failures in 15 min locks the address - slows username
//    enumeration and spray attacks without punishing one shared-table typo.
// DB-backed (login_attempts) because serverless instances share no memory.
// Successful login clears the account key only; the IP tally stands.
// Fail-open on DB errors: a broken limiter must never lock out the site.
// ---------------------------------------------------------------------------

const ACCOUNT_LIMIT = { max: 5, windowMin: 15, lockMin: 15 };
const IP_LIMIT = { max: 30, windowMin: 15, lockMin: 15 };

export interface LimitCheck {
  allowed: boolean;
  /** Whole minutes until the lock lifts - for the "try again in N minutes" message. */
  retryMinutes: number;
}

interface Row { fails: number; windowStart: number; lockedUntil: number | null }

async function readRow(key: string): Promise<Row | null> {
  const r = await getDb().execute({ sql: "SELECT fails, window_start, locked_until FROM login_attempts WHERE key = ?", args: [key] });
  const row = r.rows[0];
  if (!row) return null;
  return {
    fails: Number(row.fails ?? 0),
    windowStart: Date.parse(((row.window_start as string) ?? "") + "Z") || 0,
    lockedUntil: row.locked_until ? Date.parse((row.locked_until as string) + "Z") || null : null,
  };
}

function minutesLeft(untilMs: number): number {
  return Math.max(1, Math.ceil((untilMs - Date.now()) / 60000));
}

async function checkKey(key: string, limit: typeof ACCOUNT_LIMIT): Promise<LimitCheck> {
  const row = await readRow(key);
  if (!row) return { allowed: true, retryMinutes: 0 };
  const now = Date.now();
  if (row.lockedUntil && row.lockedUntil > now) return { allowed: false, retryMinutes: minutesLeft(row.lockedUntil) };
  // window passed (and any lock expired) -> stale row, treat as clean
  if (now - row.windowStart > limit.windowMin * 60000) return { allowed: true, retryMinutes: 0 };
  if (row.fails >= limit.max) {
    // window still open and over the line but no lock stamped (e.g. limit
    // config tightened) - honor the spirit: locked until the window ends
    return { allowed: false, retryMinutes: minutesLeft(row.windowStart + limit.windowMin * 60000) };
  }
  return { allowed: true, retryMinutes: 0 };
}

async function bumpKey(key: string, limit: typeof ACCOUNT_LIMIT): Promise<void> {
  const db = getDb();
  const row = await readRow(key);
  const now = Date.now();
  const stale = !row || (now - row.windowStart > limit.windowMin * 60000 && (!row.lockedUntil || row.lockedUntil <= now));
  if (stale) {
    await db.execute({
      sql: `INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES (?, 1, datetime('now'), NULL)
            ON CONFLICT(key) DO UPDATE SET fails = 1, window_start = datetime('now'), locked_until = NULL`,
      args: [key],
    });
    return;
  }
  const fails = row.fails + 1;
  const lock = fails >= limit.max;
  await db.execute({
    sql: `UPDATE login_attempts SET fails = ?, locked_until = ${lock ? `datetime('now', '+${limit.lockMin} minutes')` : "locked_until"} WHERE key = ?`,
    args: [fails, key],
  });
}

function accountKey(surface: string, identifier: string): string {
  return `${surface}:${identifier.toLowerCase().trim()}`.slice(0, 200);
}

/** Call BEFORE verifying credentials. */
export async function checkLoginAllowed(surface: string, identifier: string, ip: string | null): Promise<LimitCheck> {
  try {
    await ensureSchema();
    const account = await checkKey(accountKey(surface, identifier), ACCOUNT_LIMIT);
    if (!account.allowed) return account;
    if (ip) {
      const byIp = await checkKey(`ip:${ip}`.slice(0, 200), IP_LIMIT);
      if (!byIp.allowed) return byIp;
    }
    return { allowed: true, retryMinutes: 0 };
  } catch {
    return { allowed: true, retryMinutes: 0 }; // fail open
  }
}

/** Call after a FAILED credential check. */
export async function noteLoginFailure(surface: string, identifier: string, ip: string | null): Promise<void> {
  try {
    await bumpKey(accountKey(surface, identifier), ACCOUNT_LIMIT);
    if (ip) await bumpKey(`ip:${ip}`.slice(0, 200), IP_LIMIT);
  } catch { /* fail open */ }
}

/** Call after a SUCCESSFUL login - forgives the account, not the IP. */
export async function noteLoginSuccess(surface: string, identifier: string): Promise<void> {
  try {
    await getDb().execute({ sql: "DELETE FROM login_attempts WHERE key = ?", args: [accountKey(surface, identifier)] });
  } catch { /* fail open */ }
}

/** First hop of x-forwarded-for, or null - good enough for rate keys. */
export function clientIp(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0]?.trim();
  return first || null;
}
