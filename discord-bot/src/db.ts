import { createClient, type Client } from "@libsql/client";

// ---------------------------------------------------------------------------
// This bot is a standalone Node process, deliberately NOT importing anything
// from ../src/lib - that's a Next.js app full of "use server" modules and
// server-only assumptions. Instead this is a small, self-contained query
// layer against the exact same Turso database (same DATABASE_URL /
// DATABASE_AUTH_TOKEN as the website), covering only what the bot needs. See
// db/schema.sql in the website for the authoritative table definitions -
// this file never creates or migrates schema, only the website does that via
// ensureSchema().
// ---------------------------------------------------------------------------

let client: Client | undefined;

export function getDb(): Client {
  if (!client) {
    const url = process.env.DATABASE_URL;
    const authToken = process.env.DATABASE_AUTH_TOKEN;
    if (!url) throw new Error("DATABASE_URL is not set - see .env.example");
    client = createClient(authToken ? { url, authToken } : { url });
  }
  return client;
}

export interface BotCharacter {
  id: string;
  name: string;
  isPc: boolean;
  portraitPath: string | null;
  summary: string;
  charClass: string | null;
  status: string | null;
  factionName: string | null;
}

export interface BotLocation {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface BotMusicTrack {
  id: string;
  name: string;
  tags: string | null;
  fileUrl: string;
}

export async function getCampaignIdForGuild(guildId: string): Promise<string | null> {
  const r = await getDb().execute({
    sql: "SELECT campaign_id FROM guild_links WHERE guild_id = ?",
    args: [guildId],
  });
  return (r.rows[0]?.campaign_id as string) ?? null;
}

export type ConsumedLinkCode =
  | { kind: "player"; campaignId: string; playerId: string }
  | { kind: "campaign"; campaignId: string };

/** Validates + marks a pairing code used in one step. Returns null if the code is unknown, expired, or already used. */
export async function consumeLinkCode(code: string): Promise<ConsumedLinkCode | null> {
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT * FROM link_codes WHERE code = ?",
    args: [code.trim().toUpperCase()],
  });
  const row = r.rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at as string).getTime() < Date.now()) return null;

  await db.execute({ sql: "UPDATE link_codes SET used_at = datetime('now') WHERE id = ?", args: [row.id as string] });

  if (row.kind === "player") {
    return { kind: "player", campaignId: row.campaign_id as string, playerId: row.player_id as string };
  }
  return { kind: "campaign", campaignId: row.campaign_id as string };
}

export async function linkGuildToCampaign(guildId: string, campaignId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO guild_links (id, guild_id, campaign_id) VALUES (lower(hex(randomblob(16))), ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET campaign_id = excluded.campaign_id, linked_at = datetime('now')`,
    args: [guildId, campaignId],
  });
}

export async function linkPlayerDiscordAccount(playerId: string, discordUserId: string): Promise<void> {
  await getDb().execute({
    sql: "UPDATE players SET discord_user_id = ?, updated_at = datetime('now') WHERE id = ?",
    args: [discordUserId, playerId],
  });
}

/** The character (if any) this Discord account is allowed to speak/act as via its own PC link. */
export async function getOwnedCharacterId(discordUserId: string, campaignId: string): Promise<string | null> {
  const r = await getDb().execute({
    sql: "SELECT character_id FROM players WHERE discord_user_id = ? AND campaign_id = ?",
    args: [discordUserId, campaignId],
  });
  return (r.rows[0]?.character_id as string) ?? null;
}

/** Case-insensitive mask lookup within a campaign. */
export async function getCharacterByMask(campaignId: string, mask: string): Promise<BotCharacter | null> {
  const r = await getDb().execute({
    sql: `SELECT c.id, c.name, c.is_pc, c.portrait_path, c.summary, c.char_class, c.status,
                 (SELECT f.name FROM character_factions cf JOIN factions f ON f.id = cf.faction_id
                  WHERE cf.character_id = c.id LIMIT 1) AS faction_name
          FROM characters c
          WHERE c.campaign_id = ? AND lower(c.mask) = lower(?)`,
    args: [campaignId, mask],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    isPc: !!row.is_pc,
    portraitPath: (row.portrait_path as string) ?? null,
    summary: row.summary as string,
    charClass: (row.char_class as string) ?? null,
    status: (row.status as string) ?? null,
    factionName: (row.faction_name as string) ?? null,
  };
}

export async function getCharacterById(characterId: string): Promise<BotCharacter | null> {
  const r = await getDb().execute({
    sql: `SELECT c.id, c.name, c.is_pc, c.portrait_path, c.summary, c.char_class, c.status,
                 (SELECT f.name FROM character_factions cf JOIN factions f ON f.id = cf.faction_id
                  WHERE cf.character_id = c.id LIMIT 1) AS faction_name
          FROM characters c WHERE c.id = ?`,
    args: [characterId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    isPc: !!row.is_pc,
    portraitPath: (row.portrait_path as string) ?? null,
    summary: row.summary as string,
    charClass: (row.char_class as string) ?? null,
    status: (row.status as string) ?? null,
    factionName: (row.faction_name as string) ?? null,
  };
}

/** NPCs grouped by their first faction (or "Unaffiliated"), for the /panel npcs menu. */
export async function listNpcsByFaction(campaignId: string): Promise<Map<string, BotCharacter[]>> {
  const r = await getDb().execute({
    sql: `SELECT c.id, c.name, c.is_pc, c.portrait_path, c.summary, c.char_class, c.status,
                 (SELECT f.name FROM character_factions cf JOIN factions f ON f.id = cf.faction_id
                  WHERE cf.character_id = c.id LIMIT 1) AS faction_name
          FROM characters c WHERE c.campaign_id = ? AND c.is_pc = 0 ORDER BY c.name ASC`,
    args: [campaignId],
  });
  const groups = new Map<string, BotCharacter[]>();
  for (const row of r.rows) {
    const char: BotCharacter = {
      id: row.id as string,
      name: row.name as string,
      isPc: false,
      portraitPath: (row.portrait_path as string) ?? null,
      summary: row.summary as string,
      charClass: (row.char_class as string) ?? null,
      status: (row.status as string) ?? null,
      factionName: (row.faction_name as string) ?? null,
    };
    const key = char.factionName ?? "Unaffiliated";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(char);
  }
  return groups;
}

export async function listLocations(campaignId: string): Promise<BotLocation[]> {
  const r = await getDb().execute({
    sql: "SELECT id, name, type, description FROM locations WHERE campaign_id = ? ORDER BY name ASC",
    args: [campaignId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    type: row.type as string,
    description: row.description as string,
  }));
}

export async function listMusicTracks(campaignId: string): Promise<BotMusicTrack[]> {
  const r = await getDb().execute({
    sql: "SELECT id, name, tags, file_url FROM music_tracks WHERE campaign_id = ? ORDER BY name ASC",
    args: [campaignId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    tags: (row.tags as string) ?? null,
    fileUrl: row.file_url as string,
  }));
}

export async function getMusicTrackById(id: string): Promise<BotMusicTrack | null> {
  const r = await getDb().execute({ sql: "SELECT id, name, tags, file_url FROM music_tracks WHERE id = ?", args: [id] });
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id as string, name: row.name as string, tags: (row.tags as string) ?? null, fileUrl: row.file_url as string };
}

/** Raw character_sheets.data JSON blob, parsed - see rolls.ts for how it's used. */
export async function getCharacterSheetData(characterId: string): Promise<Record<string, unknown> | null> {
  const r = await getDb().execute({
    sql: "SELECT data FROM character_sheets WHERE character_id = ?",
    args: [characterId],
  });
  const row = r.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.data as string);
  } catch {
    return null;
  }
}
