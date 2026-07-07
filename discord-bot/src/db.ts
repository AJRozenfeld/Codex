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

// ---------------------------------------------------------------------------
// Initiative tracker / battle mode (2026-07-06). See db/schema.sql's design
// note above guild_playback_state/battle_state/battle_combatants for the
// full rationale. All orchestration (rendering the tracker embed, deciding
// when to (re)post vs. edit it, joining voice channels) lives in battle.ts -
// this section is pure data access, matching the rest of this file.
// ---------------------------------------------------------------------------

export interface BattleState {
  id: string;
  guildId: string;
  campaignId: string;
  channelId: string;
  trackerMessageId: string | null;
  roundNumber: number;
  currentCharacterId: string | null;
  previousTrackId: string | null;
}

export interface BattleCombatant {
  characterId: string;
  name: string;
  portraitPath: string | null;
  initiativeScore: number;
  rolledAt: string;
}

function rowToBattleState(row: Record<string, unknown>): BattleState {
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    campaignId: row.campaign_id as string,
    channelId: row.channel_id as string,
    trackerMessageId: (row.tracker_message_id as string) ?? null,
    roundNumber: Number(row.round_number),
    currentCharacterId: (row.current_character_id as string) ?? null,
    previousTrackId: (row.previous_track_id as string) ?? null,
  };
}

export async function getActiveBattle(guildId: string): Promise<BattleState | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM battle_state WHERE guild_id = ?", args: [guildId] });
  const row = r.rows[0];
  return row ? rowToBattleState(row) : null;
}

export async function startBattle(
  guildId: string,
  campaignId: string,
  channelId: string,
  previousTrackId: string | null
): Promise<BattleState> {
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: "INSERT INTO battle_state (id, guild_id, campaign_id, channel_id, previous_track_id) VALUES (?, ?, ?, ?, ?)",
    args: [id, guildId, campaignId, channelId, previousTrackId],
  });
  return { id, guildId, campaignId, channelId, trackerMessageId: null, roundNumber: 1, currentCharacterId: null, previousTrackId };
}

export async function setTrackerMessageId(battleId: string, messageId: string): Promise<void> {
  await getDb().execute({ sql: "UPDATE battle_state SET tracker_message_id = ? WHERE id = ?", args: [messageId, battleId] });
}

/** Sorted turn order: highest initiative first, earliest roll breaking ties. */
export async function getBattleCombatants(battleId: string): Promise<BattleCombatant[]> {
  const r = await getDb().execute({
    sql: `SELECT bc.character_id, bc.initiative_score, bc.rolled_at, c.name, c.portrait_path
          FROM battle_combatants bc JOIN characters c ON c.id = bc.character_id
          WHERE bc.battle_id = ?
          ORDER BY bc.initiative_score DESC, bc.rolled_at ASC`,
    args: [battleId],
  });
  return r.rows.map((row) => ({
    characterId: row.character_id as string,
    name: row.name as string,
    portraitPath: (row.portrait_path as string) ?? null,
    initiativeScore: Number(row.initiative_score),
    rolledAt: row.rolled_at as string,
  }));
}

/** Records or updates a character's initiative roll for the current battle - re-rolling replaces the old value. */
export async function recordInitiativeRoll(battleId: string, characterId: string, score: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO battle_combatants (id, battle_id, character_id, initiative_score)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(battle_id, character_id) DO UPDATE SET initiative_score = excluded.initiative_score, rolled_at = datetime('now')`,
    args: [crypto.randomUUID(), battleId, characterId, score],
  });
}

/**
 * Advances to the next combatant in sorted turn order, wrapping to the top
 * (and incrementing round_number) past the end. If no one currently has the
 * turn (the very first /next of the battle), starts at the top of the order
 * without advancing the round. Returns null if nobody has rolled yet.
 */
export async function advanceBattleTurn(battleId: string): Promise<{ roundNumber: number; currentCharacterId: string } | null> {
  const battleRow = await getDb().execute({ sql: "SELECT * FROM battle_state WHERE id = ?", args: [battleId] });
  const battle = rowToBattleState(battleRow.rows[0]);
  const combatants = await getBattleCombatants(battleId);
  if (combatants.length === 0) return null;

  const currentIndex = battle.currentCharacterId
    ? combatants.findIndex((c) => c.characterId === battle.currentCharacterId)
    : -1;
  let nextIndex: number;
  let nextRound = battle.roundNumber;
  if (currentIndex === -1) {
    nextIndex = 0;
  } else {
    nextIndex = currentIndex + 1;
    if (nextIndex >= combatants.length) {
      nextIndex = 0;
      nextRound += 1;
    }
  }
  const nextCharacterId = combatants[nextIndex].characterId;
  await getDb().execute({
    sql: "UPDATE battle_state SET round_number = ?, current_character_id = ? WHERE id = ?",
    args: [nextRound, nextCharacterId, battleId],
  });
  return { roundNumber: nextRound, currentCharacterId: nextCharacterId };
}

export async function endBattle(battleId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM battle_state WHERE id = ?", args: [battleId] });
}

/** A random track tagged "battle" (case-insensitive substring match against the free-text tags field). */
export async function getRandomBattleTrack(campaignId: string): Promise<BotMusicTrack | null> {
  const r = await getDb().execute({
    sql: "SELECT id, name, tags, file_url FROM music_tracks WHERE campaign_id = ? AND lower(tags) LIKE '%battle%' ORDER BY RANDOM() LIMIT 1",
    args: [campaignId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id as string, name: row.name as string, tags: (row.tags as string) ?? null, fileUrl: row.file_url as string };
}

/** Whatever track was last selected for this guild (via /panel music or a battle) - used to restore it after a fight ends. */
export async function getGuildPlaybackTrackId(guildId: string): Promise<string | null> {
  const r = await getDb().execute({ sql: "SELECT track_id FROM guild_playback_state WHERE guild_id = ?", args: [guildId] });
  return (r.rows[0]?.track_id as string) ?? null;
}

export async function setGuildPlaybackTrackId(guildId: string, trackId: string | null): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO guild_playback_state (guild_id, track_id, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(guild_id) DO UPDATE SET track_id = excluded.track_id, updated_at = datetime('now')`,
    args: [guildId, trackId],
  });
}
