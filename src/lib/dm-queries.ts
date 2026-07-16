import { cache } from "react";
import { getDb, ensureSchema, newId, LEGACY_DM_ID } from "./db";
import { getAdminSession } from "./auth";
import { hashPassword, verifyPassword } from "./password";
import { slugify } from "./slug";

// ---------------------------------------------------------------------------
// License system (2026-07-16). A "license" is a dm_accounts row: it carries
// the DM's login credentials (once claimed), their shareable player-join
// slug, and the quotas the master panel set for them. Three tiers of auth
// use this file:
//   - MASTER (/master, MASTER_PASSWORD): issues/edits licenses. master*
//     functions below must only be called behind requireMaster-style checks.
//   - DM (/admin): logs in with the username+password they chose at claim
//     time. The founder account (LEGACY_DM_ID) has no credentials and logs
//     in with the ADMIN_PASSWORD master key instead.
//   - PLAYER (/join/<dm-slug>): self-registers under a DM; usernames are
//     unique per DM (UNIQUE(dm_id, username)), so two different DMs' players
//     can share a username - the per-DM login link disambiguates.
// ---------------------------------------------------------------------------

export interface DmAccount {
  id: string;
  slug: string;
  name: string;
  username: string | null;
  inviteToken: string | null;
  maxCampaigns: number;
  maxPlayersPerCampaign: number;
  maxArticlesPerCampaign: number;
  maxMapsPerCampaign: number;
  isActive: boolean;
  createdAt: string;
}

export interface DmAccountWithUsage extends DmAccount {
  campaignCount: number;
  playerCount: number;
}

function rowToDm(row: any): DmAccount {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    username: (row.username as string) ?? null,
    inviteToken: (row.invite_token as string) ?? null,
    maxCampaigns: Number(row.max_campaigns),
    maxPlayersPerCampaign: Number(row.max_players_per_campaign),
    maxArticlesPerCampaign: Number(row.max_articles_per_campaign),
    maxMapsPerCampaign: Number(row.max_maps_per_campaign),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as string,
  };
}

/** Which DM account the current admin session belongs to. cache()d per
 *  request. Sessions minted before multi-tenancy carry no dmId and resolve
 *  to the founder account, so Aviv's existing login keeps working. */
export const getCurrentDmId = cache(async (): Promise<string> => {
  const session = await getAdminSession();
  return session.dmId ?? LEGACY_DM_ID;
});

export async function getDmAccount(id: string): Promise<DmAccount | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM dm_accounts WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToDm(r.rows[0]) : null;
}

export async function getDmBySlug(slug: string): Promise<DmAccount | null> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM dm_accounts WHERE slug = ?", args: [slug] });
  return r.rows[0] ? rowToDm(r.rows[0]) : null;
}

/** DM login for /admin/login. Returns the account id on success, null on any
 *  failure (unknown username, unclaimed account, wrong password, deactivated
 *  license) - the caller shows one generic error, no oracle. */
export async function dmLogin(username: string, password: string): Promise<string | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, password_hash, is_active FROM dm_accounts WHERE username = ?",
    args: [username],
  });
  const row = r.rows[0];
  if (!row || !row.password_hash) return null;
  if (!Number(row.is_active)) return null;
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return row.id as string;
}

// ---------------------------------------------------------------------------
// Master panel operations.
// ---------------------------------------------------------------------------

export interface LicenseQuotas {
  maxCampaigns: number;
  maxPlayersPerCampaign: number;
  maxArticlesPerCampaign: number;
  maxMapsPerCampaign: number;
}

async function uniqueDmSlug(base: string): Promise<string> {
  const db = getDb();
  let slug = slugify(base) || "dm";
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM dm_accounts WHERE slug = ?", args: [slug] });
    if (r.rows.length === 0) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

export async function masterListDms(): Promise<DmAccountWithUsage[]> {
  await ensureSchema();
  const db = getDb();
  const [accounts, campaignCounts, playerCounts] = await Promise.all([
    db.execute("SELECT * FROM dm_accounts ORDER BY created_at ASC"),
    db.execute("SELECT dm_id, COUNT(*) AS n FROM campaigns GROUP BY dm_id"),
    db.execute("SELECT dm_id, COUNT(*) AS n FROM players GROUP BY dm_id"),
  ]);
  const cByDm = new Map(campaignCounts.rows.map((r) => [r.dm_id as string, Number(r.n)]));
  const pByDm = new Map(playerCounts.rows.map((r) => [r.dm_id as string, Number(r.n)]));
  return accounts.rows.map((row) => ({
    ...rowToDm(row),
    campaignCount: cByDm.get(row.id as string) ?? 0,
    playerCount: pByDm.get(row.id as string) ?? 0,
  }));
}

/** Issues a new license: an unclaimed dm_accounts row + one-time invite
 *  token. The DM sets username/password via /claim/<token>. */
export async function masterCreateDm(name: string, quotas: LicenseQuotas): Promise<DmAccount> {
  await ensureSchema();
  const db = getDb();
  const id = newId();
  const slug = await uniqueDmSlug(name);
  const inviteToken = newId();
  await db.execute({
    sql: `INSERT INTO dm_accounts (id, slug, name, invite_token, max_campaigns, max_players_per_campaign, max_articles_per_campaign, max_maps_per_campaign)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      id,
      slug,
      name,
      inviteToken,
      Math.max(1, quotas.maxCampaigns),
      Math.max(1, quotas.maxPlayersPerCampaign),
      Math.max(1, quotas.maxArticlesPerCampaign),
      Math.max(0, quotas.maxMapsPerCampaign),
    ],
  });
  return (await getDmAccount(id))!;
}

export async function masterUpdateDm(id: string, name: string, quotas: LicenseQuotas): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE dm_accounts SET name=?, max_campaigns=?, max_players_per_campaign=?, max_articles_per_campaign=?, max_maps_per_campaign=?, updated_at=datetime('now') WHERE id=?`,
    args: [
      name,
      Math.max(1, quotas.maxCampaigns),
      Math.max(1, quotas.maxPlayersPerCampaign),
      Math.max(1, quotas.maxArticlesPerCampaign),
      Math.max(0, quotas.maxMapsPerCampaign),
      id,
    ],
  });
}

export async function masterSetDmActive(id: string, active: boolean): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE dm_accounts SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
    args: [active ? 1 : 0, id],
  });
}

/** New one-time invite link (e.g. the DM lost the first one, or you want to
 *  let them reset their credentials). Claiming again overwrites username +
 *  password but touches nothing else on the account. */
export async function masterRegenerateInvite(id: string): Promise<string> {
  await ensureSchema();
  const token = newId();
  await getDb().execute({
    sql: "UPDATE dm_accounts SET invite_token = ?, updated_at = datetime('now') WHERE id = ?",
    args: [token, id],
  });
  return token;
}

/** Master sets/resets a license's DM password directly (beta support tool -
 *  "I forgot my password" without waiting for a self-serve reset flow). The
 *  founder account has no per-account password (it uses the ADMIN_PASSWORD
 *  master key), so it's refused here. */
export async function masterSetDmPassword(id: string, password: string): Promise<void> {
  if (id === LEGACY_DM_ID) throw new Error("The founder account logs in with the master password.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE dm_accounts SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
    args: [hashPassword(password), id],
  });
}

/** Every campaign across every license, for the master dashboard's
 *  per-license campaign listings. */
export async function masterListAllCampaigns(): Promise<{ id: string; dmId: string; name: string }[]> {
  await ensureSchema();
  const r = await getDb().execute("SELECT id, dm_id, name FROM campaigns ORDER BY created_at ASC");
  return r.rows.map((row) => ({ id: row.id as string, dmId: row.dm_id as string, name: row.name as string }));
}

/** Deletes the license and, via ON DELETE CASCADE from campaigns.dm_id and
 *  players.dm_id, every campaign and player under it. The founder account
 *  refuses deletion outright. */
export async function masterDeleteDm(id: string): Promise<void> {
  if (id === LEGACY_DM_ID) throw new Error("The founder account cannot be deleted.");
  await ensureSchema();
  const db = getDb();
  // Belt and braces: cascade explicitly too, in case this database's
  // campaigns.dm_id arrived via ALTER TABLE (SQLite enforces those FKs, but
  // an explicit delete order costs one statement and removes all doubt).
  await db.batch(
    [
      { sql: "DELETE FROM campaigns WHERE dm_id = ?", args: [id] },
      { sql: "DELETE FROM players WHERE dm_id = ?", args: [id] },
      { sql: "DELETE FROM dm_accounts WHERE id = ?", args: [id] },
    ],
    "write"
  );
}

// ---------------------------------------------------------------------------
// Claim flow (/claim/<token>) - the DM opens their one-time invite link and
// picks credentials. On first claim they also get their blank campaign.
// ---------------------------------------------------------------------------

export async function getDmByInviteToken(token: string): Promise<DmAccount | null> {
  if (!token) return null;
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM dm_accounts WHERE invite_token = ?", args: [token] });
  return r.rows[0] ? rowToDm(r.rows[0]) : null;
}

export async function claimDmAccount(
  token: string,
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  const db = getDb();
  const account = await getDmByInviteToken(token);
  if (!account) return { ok: false, error: "This invite link is invalid or was already used." };
  if (!account.isActive) return { ok: false, error: "This license has been deactivated." };
  const uname = username.trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(uname)) {
    return { ok: false, error: "Username must be 3-32 characters: letters, numbers, _ . -" };
  }
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const taken = await db.execute({
    sql: "SELECT id FROM dm_accounts WHERE username = ? AND id != ?",
    args: [uname, account.id],
  });
  if (taken.rows[0]) return { ok: false, error: "That username is taken - pick another." };

  await db.execute({
    sql: `UPDATE dm_accounts SET username = ?, password_hash = ?, invite_token = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [uname, hashPassword(password), account.id],
  });

  // First claim: hand the DM their blank campaign (no moons - that's Aviv's
  // homebrew cosmology, not core D&D). A re-issued invite (credentials
  // reset) must NOT create a second campaign.
  const existing = await db.execute({ sql: "SELECT id FROM campaigns WHERE dm_id = ? LIMIT 1", args: [account.id] });
  if (!existing.rows[0]) {
    const campaignId = newId();
    await db.execute({
      sql: "INSERT INTO campaigns (id, dm_id, slug, name, show_moons) VALUES (?,?,?,?,0)",
      args: [campaignId, account.id, `${account.slug}-campaign`, `${account.name}'s Campaign`],
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Player self-registration (/join/<dm-slug>).
// ---------------------------------------------------------------------------

export async function registerPlayer(
  dmSlug: string,
  username: string,
  displayName: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  const db = getDb();
  const dm = await getDmBySlug(dmSlug);
  if (!dm || !dm.isActive) return { ok: false, error: "This join link is not active." };
  const uname = username.trim();
  const dname = displayName.trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(uname)) {
    return { ok: false, error: "Username must be 3-32 characters: letters, numbers, _ . -" };
  }
  if (!dname) return { ok: false, error: "Display name is required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const taken = await db.execute({
    sql: "SELECT id FROM players WHERE dm_id = ? AND username = ?",
    args: [dm.id, uname],
  });
  if (taken.rows[0]) return { ok: false, error: "That username is taken in this DM's game - pick another." };

  // campaign_id stays NULL: the DM assigns the player to a campaign from
  // /admin/players (where the per-campaign player quota is enforced).
  await db.execute({
    sql: "INSERT INTO players (id, dm_id, campaign_id, username, password_hash, display_name) VALUES (?,?,NULL,?,?,?)",
    args: [newId(), dm.id, uname, hashPassword(password), dname],
  });
  return { ok: true };
}

/** Player login scoped to one DM's namespace (per-DM links). The bare /login
 *  page uses the founder account's scope so Aviv's existing players keep
 *  logging in exactly as before. */
export async function playerLogin(dmId: string, username: string, password: string): Promise<string | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, password_hash FROM players WHERE dm_id = ? AND username = ?",
    args: [dmId, username.trim()],
  });
  const row = r.rows[0];
  if (!row || !verifyPassword(password, row.password_hash as string)) return null;
  return row.id as string;
}
