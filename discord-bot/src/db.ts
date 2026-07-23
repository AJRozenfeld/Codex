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

// Music is shared across all of a DM's campaigns (2026-07-20): resolve the
// guild's campaign to its owning DM and scope the library on dm_id.
const FOUNDER_DM_ID = "00000000-0000-0000-0000-0000000000d0";
async function dmIdForCampaign(campaignId: string): Promise<string> {
  const r = await getDb().execute({ sql: "SELECT dm_id FROM campaigns WHERE id = ?", args: [campaignId] });
  return (r.rows[0]?.dm_id as string) ?? FOUNDER_DM_ID;
}

export async function listMusicTracks(campaignId: string): Promise<BotMusicTrack[]> {
  const dmId = await dmIdForCampaign(campaignId);
  const r = await getDb().execute({
    sql: "SELECT id, name, tags, file_url FROM music_tracks WHERE dm_id = ? ORDER BY name ASC",
    args: [dmId],
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

// ---------------------------------------------------------------------------
// Playlists (2026-07-10). See db/schema.sql's playlists/playlist_tracks
// comment for the full design - website admin owns creating/editing them
// (src/lib/discord-io.ts), the bot only ever reads. /panel music lets Aviv
// choose a single track OR a playlist; shuffle (if chosen) is applied here,
// at read time, never persisted - see voice.ts's playPlaylistInChannel.
// ---------------------------------------------------------------------------

export interface BotPlaylist {
  id: string;
  name: string;
  trackCount: number;
}

export async function listPlaylists(campaignId: string): Promise<BotPlaylist[]> {
  const r = await getDb().execute({
    sql: `SELECT p.id, p.name, COUNT(pt.id) AS track_count
          FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
          WHERE p.campaign_id = ? GROUP BY p.id ORDER BY p.name ASC`,
    args: [campaignId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    trackCount: Number(row.track_count ?? 0),
  }));
}

/** Ordered tracks (stored play order) for a playlist - callers shuffle themselves if needed. */
export async function getPlaylistTracks(playlistId: string): Promise<BotMusicTrack[]> {
  const r = await getDb().execute({
    sql: `SELECT mt.id, mt.name, mt.tags, mt.file_url
          FROM playlist_tracks pt JOIN music_tracks mt ON mt.id = pt.track_id
          WHERE pt.playlist_id = ? ORDER BY pt.sort_order ASC`,
    args: [playlistId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    tags: (row.tags as string) ?? null,
    fileUrl: row.file_url as string,
  }));
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
  /** Whose turn it is, by battle_combatants row id - see BattleCombatant.id below (2026-07-12, Scenes feature). */
  currentCombatantId: string | null;
  previousTrackId: string | null;
}

export interface BattleCombatant {
  /** battle_combatants row id - the stable identity used for turn order, since a monster combatant has no character_id. */
  id: string;
  /** Set only for a real Codex character (a PC self-rolling, or an NPC added via a Scene) - null for a monster/ad-hoc combatant. */
  characterId: string | null;
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
    currentCombatantId: (row.current_combatant_id as string) ?? null,
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
  return { id, guildId, campaignId, channelId, trackerMessageId: null, roundNumber: 1, currentCombatantId: null, previousTrackId };
}

export async function setTrackerMessageId(battleId: string, messageId: string): Promise<void> {
  await getDb().execute({ sql: "UPDATE battle_state SET tracker_message_id = ? WHERE id = ?", args: [messageId, battleId] });
}

/** Sorted turn order: highest initiative first, earliest roll breaking ties. */
export async function getBattleCombatants(battleId: string): Promise<BattleCombatant[]> {
  // LEFT JOIN (not JOIN) since a monster/ad-hoc combatant has no characters
  // row at all (2026-07-12, Scenes feature) - COALESCE falls back to the
  // stored creature_name (already suffixed "Goblin 1"/"Goblin 2" etc. for
  // quantity>1 by beginSceneBattle in battle.ts) whenever character_id is NULL.
  const r = await getDb().execute({
    sql: `SELECT bc.id, bc.character_id, bc.creature_name, bc.initiative_score, bc.rolled_at,
                 COALESCE(c.name, bc.creature_name) AS name, c.portrait_path
          FROM battle_combatants bc LEFT JOIN characters c ON c.id = bc.character_id
          WHERE bc.battle_id = ?
          ORDER BY bc.initiative_score DESC, bc.rolled_at ASC`,
    args: [battleId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    characterId: (row.character_id as string) ?? null,
    name: row.name as string,
    portraitPath: (row.portrait_path as string) ?? null,
    initiativeScore: Number(row.initiative_score),
    rolledAt: row.rolled_at as string,
  }));
}

/** Records or updates a character's initiative roll for the current battle - re-rolling replaces the old value. Characters only - see insertCreatureCombatant for monster/ad-hoc entries. */
export async function recordInitiativeRoll(battleId: string, characterId: string, score: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO battle_combatants (id, battle_id, character_id, initiative_score)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(battle_id, character_id) DO UPDATE SET initiative_score = excluded.initiative_score, rolled_at = datetime('now')`,
    args: [crypto.randomUUID(), battleId, characterId, score],
  });
}

/**
 * Inserts a monster/ad-hoc combatant (character_id NULL, a plain display
 * name instead) with an already-computed initiative score - used by
 * beginSceneBattle in battle.ts, which auto-rolls every scene creature at
 * activation time since they can't self-report *init* in chat the way a
 * player can. No ON CONFLICT/upsert here (unlike recordInitiativeRoll) since
 * each call is a brand-new combatant, never a re-roll of an existing one.
 */
export async function insertCreatureCombatant(battleId: string, name: string, score: number): Promise<void> {
  await getDb().execute({
    sql: "INSERT INTO battle_combatants (id, battle_id, character_id, creature_name, initiative_score) VALUES (?, ?, NULL, ?, ?)",
    args: [crypto.randomUUID(), battleId, name, score],
  });
}

/**
 * Advances to the next combatant in sorted turn order, wrapping to the top
 * (and incrementing round_number) past the end. If no one currently has the
 * turn (the very first /next of the battle), starts at the top of the order
 * without advancing the round. Returns null if nobody has rolled yet.
 */
export async function advanceBattleTurn(battleId: string): Promise<{ roundNumber: number; currentCombatantId: string } | null> {
  const battleRow = await getDb().execute({ sql: "SELECT * FROM battle_state WHERE id = ?", args: [battleId] });
  const battle = rowToBattleState(battleRow.rows[0]);
  const combatants = await getBattleCombatants(battleId);
  if (combatants.length === 0) return null;

  const currentIndex = battle.currentCombatantId
    ? combatants.findIndex((c) => c.id === battle.currentCombatantId)
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
  const nextCombatantId = combatants[nextIndex].id;
  await getDb().execute({
    sql: "UPDATE battle_state SET round_number = ?, current_combatant_id = ? WHERE id = ?",
    args: [nextRound, nextCombatantId, battleId],
  });
  return { roundNumber: nextRound, currentCombatantId: nextCombatantId };
}

export async function endBattle(battleId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM battle_state WHERE id = ?", args: [battleId] });
}

/** A random track tagged "battle" (case-insensitive substring match against the free-text tags field). */
export async function getRandomBattleTrack(campaignId: string): Promise<BotMusicTrack | null> {
  const dmId = await dmIdForCampaign(campaignId);
  const r = await getDb().execute({
    sql: "SELECT id, name, tags, file_url FROM music_tracks WHERE dm_id = ? AND lower(tags) LIKE '%battle%' ORDER BY RANDOM() LIMIT 1",
    args: [dmId],
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

// ---------------------------------------------------------------------------
// Scenes (2026-07-12) - a DM-defined "hotkey" for battle setup. Created/edited
// on the website (src/lib/discord-io.ts); the bot only ever reads, then hands
// the result to beginSceneBattle in battle.ts to actually start the fight.
// See db/schema.sql's scenes/scene_creatures/scene_characters comment for the
// full design.
// ---------------------------------------------------------------------------

export interface BotScene {
  id: string;
  name: string;
}

/** One creature TYPE from a scene - `quantity` still un-expanded here; beginSceneBattle spawns that many separately-tracked combatants. */
export interface BotSceneCreatureInstance {
  name: string;
  initBonus: number;
  quantity: number;
}

export interface BotSceneDetail {
  id: string;
  name: string;
  creatures: BotSceneCreatureInstance[];
  /** Existing Codex characters (almost always NPCs) to include - these still roll their own *init* normally, see beginSceneBattle. */
  characterIds: string[];
  trackId: string | null;
  playlistId: string | null;
  shuffle: boolean;
}

export async function listScenes(campaignId: string): Promise<BotScene[]> {
  const r = await getDb().execute({
    sql: "SELECT id, name FROM scenes WHERE campaign_id = ? ORDER BY sort_order ASC, name ASC",
    args: [campaignId],
  });
  return r.rows.map((row) => ({ id: row.id as string, name: row.name as string }));
}

export async function getSceneForActivation(sceneId: string): Promise<BotSceneDetail | null> {
  const db = getDb();
  const sceneRow = await db.execute({ sql: "SELECT * FROM scenes WHERE id = ?", args: [sceneId] });
  const s = sceneRow.rows[0];
  if (!s) return null;
  const creaturesResult = await db.execute({
    sql: "SELECT name, init_bonus, quantity FROM scene_creatures WHERE scene_id = ? ORDER BY sort_order ASC",
    args: [sceneId],
  });
  const characterResult = await db.execute({
    sql: "SELECT character_id FROM scene_characters WHERE scene_id = ? ORDER BY sort_order ASC",
    args: [sceneId],
  });
  return {
    id: s.id as string,
    name: s.name as string,
    creatures: creaturesResult.rows.map((row) => ({
      name: row.name as string,
      initBonus: Number(row.init_bonus ?? 0),
      quantity: Number(row.quantity ?? 1),
    })),
    characterIds: characterResult.rows.map((row) => row.character_id as string),
    trackId: (s.track_id as string) ?? null,
    playlistId: (s.playlist_id as string) ?? null,
    shuffle: !!s.shuffle,
  };
}

// ---------------------------------------------------------------------------
// Website -> Discord roll bridge (2026-07-16). The sheet's d20 buttons write
// rows into roll_requests; rollQueue.ts drains them here.
// ---------------------------------------------------------------------------

export interface RollRequest {
  id: string;
  campaignId: string;
  characterId: string;
  rollTarget: string;
}

/** Oldest pending requests, after expiring anything older than 90s - a
 *  stale die landing minutes late mid-conversation only confuses the table
 *  (e.g. after the bot was briefly down). */
export async function fetchPendingRollRequests(limit = 5): Promise<RollRequest[]> {
  const db = getDb();
  await db.execute(
    `UPDATE roll_requests SET status = 'expired', processed_at = datetime('now')
     WHERE status = 'pending' AND created_at < datetime('now', '-90 seconds')`
  );
  const r = await db.execute({
    sql: `SELECT id, campaign_id, character_id, roll_target FROM roll_requests
          WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    campaignId: row.campaign_id as string,
    characterId: row.character_id as string,
    rollTarget: row.roll_target as string,
  }));
}

export async function resolveRollRequest(id: string, status: "done" | "failed", detail?: string): Promise<void> {
  await getDb().execute({
    sql: "UPDATE roll_requests SET status = ?, detail = ?, processed_at = datetime('now') WHERE id = ?",
    args: [status, detail ?? null, id],
  });
}

/** Where this campaign's website-initiated rolls should land. */
export async function getRollDestination(
  campaignId: string
): Promise<{ guildId: string; rollChannelId: string | null } | null> {
  const r = await getDb().execute({
    sql: "SELECT guild_id, roll_channel_id FROM guild_links WHERE campaign_id = ? LIMIT 1",
    args: [campaignId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return { guildId: row.guild_id as string, rollChannelId: (row.roll_channel_id as string) ?? null };
}

/** messageHandler calls this on every processed mask message so rolls post
 *  wherever the table is actually talking (cached caller-side - one write
 *  only when the channel actually changes). */
export async function rememberRollChannel(guildId: string, channelId: string): Promise<void> {
  await getDb().execute({
    sql: "UPDATE guild_links SET roll_channel_id = ? WHERE guild_id = ?",
    args: [channelId, guildId],
  });
}
