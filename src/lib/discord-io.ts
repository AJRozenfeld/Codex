import { getDb, ensureSchema, newId, LEGACY_DM_ID } from "./db";
import { uploadImage } from "./blob-storage";
import { getCreature } from "./creature-queries";
import type {
  MusicTrack,
  GuildLink,
  Playlist,
  PlaylistDetail,
  PlaylistTrackItem,
  Scene,
  SceneDetail,
  SceneCreatureItem,
  SceneCharacterItem,
  CommandButton,
  CommandButtonAction,
  CommandButtonStyle,
  CustomCommand,
  CustomCommandDetail,
  CustomMask,
  DiscordSettings,
  GuildChannelInfo,
} from "./types";

// ---------------------------------------------------------------------------
// Discord bot support (2026-07-06). Shared by the website (which generates
// pairing codes and manages the music library) and the standalone bot
// process in discord-bot/ (which consumes codes via /link and reads the
// music library for its /panel music menu). See db/schema.sql's link_codes,
// guild_links, and music_tracks tables for the full design rationale.
//
// The bot does NOT import this file directly - it's a separate Node process
// with its own package.json and can't use Next.js's "use server" modules.
// It talks to the same database with its own small query layer
// (discord-bot/src/db.ts) that mirrors the read side of what's here. Keeping
// two copies of simple SELECT/UPDATE statements is a deliberate, cheap
// trade-off against forcing the bot to depend on the whole Next.js app.
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I - avoids transcription mistakes
const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export interface LinkCodeResult {
  code: string;
  expiresAt: string;
}

/**
 * Generates a fresh pairing code for a player to link their Discord account.
 * Any of the player's previous, still-unused codes are cleared first so only
 * one is ever valid at a time (avoids confusion if they hit the button
 * twice). Consumed by the bot's /link command against link_codes.
 */
export async function generatePlayerLinkCode(campaignId: string, playerId: string): Promise<LinkCodeResult> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM link_codes WHERE kind = 'player' AND player_id = ? AND used_at IS NULL",
    args: [playerId],
  });
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  await db.execute({
    sql: "INSERT INTO link_codes (id, code, kind, campaign_id, player_id, expires_at) VALUES (?, ?, 'player', ?, ?, ?)",
    args: [newId(), code, campaignId, playerId, expiresAt],
  });
  return { code, expiresAt };
}

/**
 * Generates a fresh pairing code for the DM to link a whole Discord server
 * to this campaign. Same one-active-code-at-a-time behavior as the player
 * variant above.
 */
export async function generateCampaignLinkCode(campaignId: string): Promise<LinkCodeResult> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM link_codes WHERE kind = 'campaign' AND campaign_id = ? AND used_at IS NULL",
    args: [campaignId],
  });
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  await db.execute({
    sql: "INSERT INTO link_codes (id, code, kind, campaign_id, expires_at) VALUES (?, ?, 'campaign', ?, ?)",
    args: [newId(), code, campaignId, expiresAt],
  });
  return { code, expiresAt };
}

export async function getGuildLinkForCampaign(campaignId: string): Promise<GuildLink | null> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM guild_links WHERE campaign_id = ? ORDER BY linked_at DESC LIMIT 1",
    args: [campaignId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    campaignId: row.campaign_id as string,
    linkedAt: row.linked_at as string,
  };
}

export async function unlinkGuild(campaignId: string, guildId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM guild_links WHERE campaign_id = ? AND guild_id = ?",
    args: [campaignId, guildId],
  });
}

// ---- Music library --------------------------------------------------------
// Music is shared across all of a DM's campaigns (2026-07-20): every function
// still takes the current campaignId (callers are unchanged) but resolves it
// to the owning DM and scopes on dm_id, so the same library shows up in every
// campaign that DM runs.

async function dmIdForCampaign(campaignId: string): Promise<string> {
  const r = await getDb().execute({ sql: "SELECT dm_id FROM campaigns WHERE id = ?", args: [campaignId] });
  return (r.rows[0]?.dm_id as string) ?? LEGACY_DM_ID;
}

export async function listMusicTracks(campaignId: string): Promise<MusicTrack[]> {
  await ensureSchema();
  const dmId = await dmIdForCampaign(campaignId);
  const r = await getDb().execute({
    sql: "SELECT * FROM music_tracks WHERE dm_id = ? ORDER BY name ASC",
    args: [dmId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    tags: (row.tags as string) ?? null,
    scene: (row.scene as string) ?? null,
    fileUrl: row.file_url as string,
  }));
}

async function uniqueTrackSlug(dmId: string, name: string, excludeId?: string): Promise<string> {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "track";
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({
      sql: "SELECT id FROM music_tracks WHERE dm_id = ? AND slug = ?",
      args: [dmId, slug],
    });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

export interface MusicTrackInput {
  name: string;
  tags?: string;
  scene?: string;
  file?: File | null;
  fileUrl?: string;
}

export async function upsertMusicTrack(campaignId: string, input: MusicTrackInput, id?: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const dmId = await dmIdForCampaign(campaignId);
  const slug = await uniqueTrackSlug(dmId, input.name, id);
  const trackId = id ?? newId();
  let fileUrl = input.fileUrl;
  if (input.file && input.file.size > 0) {
    fileUrl = await uploadImage(input.file, "music");
  }
  if (id) {
    if (fileUrl) {
      await db.execute({
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, scene=?, file_url=?, updated_at=datetime('now') WHERE id=? AND dm_id=?",
        args: [input.name, slug, input.tags ?? null, input.scene ?? null, fileUrl, id, dmId],
      });
    } else {
      await db.execute({
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, scene=?, updated_at=datetime('now') WHERE id=? AND dm_id=?",
        args: [input.name, slug, input.tags ?? null, input.scene ?? null, id, dmId],
      });
    }
  } else {
    if (!fileUrl) throw new Error("A track file is required.");
    await db.execute({
      sql: "INSERT INTO music_tracks (id, dm_id, slug, name, tags, scene, file_url) VALUES (?,?,?,?,?,?,?)",
      args: [trackId, dmId, slug, input.name, input.tags ?? null, input.scene ?? null, fileUrl],
    });
  }
  return trackId;
}

export async function deleteMusicTrack(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  const dmId = await dmIdForCampaign(campaignId);
  await getDb().execute({ sql: "DELETE FROM music_tracks WHERE id = ? AND dm_id = ?", args: [id, dmId] });
}

// ---- Playlists --------------------------------------------------------
// See db/schema.sql's playlists/playlist_tracks comment for the design.
// Follows the same admin CRUD shape as article_lists/article_list_items in
// admin-queries.ts (append-at-end add, swap-neighbor-sort_order reorder).

async function uniquePlaylistSlug(campaignId: string, name: string, excludeId?: string): Promise<string> {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "playlist";
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({
      sql: "SELECT id FROM playlists WHERE campaign_id = ? AND slug = ?",
      args: [campaignId, slug],
    });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

export async function listPlaylists(campaignId: string): Promise<Playlist[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.id, p.slug, p.name, COUNT(pt.id) AS track_count
          FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
          WHERE p.campaign_id = ? GROUP BY p.id ORDER BY p.name ASC`,
    args: [campaignId],
  });
  return r.rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    trackCount: Number(row.track_count ?? 0),
  }));
}

export async function getPlaylistDetail(campaignId: string, playlistId: string): Promise<PlaylistDetail | null> {
  await ensureSchema();
  const db = getDb();
  const playlistRow = await db.execute({
    sql: "SELECT id, slug, name FROM playlists WHERE id = ? AND campaign_id = ?",
    args: [playlistId, campaignId],
  });
  const p = playlistRow.rows[0];
  if (!p) return null;
  const tracksResult = await db.execute({
    sql: `SELECT pt.id, pt.sort_order, mt.id AS track_id, mt.name, mt.tags, mt.file_url
          FROM playlist_tracks pt JOIN music_tracks mt ON mt.id = pt.track_id
          WHERE pt.playlist_id = ? ORDER BY pt.sort_order ASC`,
    args: [playlistId],
  });
  const tracks: PlaylistTrackItem[] = tracksResult.rows.map((row) => ({
    id: row.id as string,
    trackId: row.track_id as string,
    name: row.name as string,
    tags: (row.tags as string) ?? null,
    fileUrl: row.file_url as string,
    sortOrder: Number(row.sort_order ?? 0),
  }));
  return { id: p.id as string, slug: p.slug as string, name: p.name as string, trackCount: tracks.length, tracks };
}

export async function createPlaylist(campaignId: string, name: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniquePlaylistSlug(campaignId, name);
  const id = newId();
  await db.execute({
    sql: "INSERT INTO playlists (id, campaign_id, slug, name) VALUES (?,?,?,?)",
    args: [id, campaignId, slug, name],
  });
  return id;
}

export async function renamePlaylist(campaignId: string, playlistId: string, name: string): Promise<void> {
  await ensureSchema();
  const slug = await uniquePlaylistSlug(campaignId, name, playlistId);
  await getDb().execute({
    sql: "UPDATE playlists SET name=?, slug=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
    args: [name, slug, playlistId, campaignId],
  });
}

export async function deletePlaylist(campaignId: string, playlistId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM playlists WHERE id = ? AND campaign_id = ?", args: [playlistId, campaignId] });
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM playlist_tracks WHERE playlist_id = ?",
    args: [playlistId],
  });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  await db.execute({
    sql: "INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, sort_order) VALUES (?,?,?,?)",
    args: [newId(), playlistId, trackId, nextOrder],
  });
}

export async function removeTrackFromPlaylist(playlistTrackId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM playlist_tracks WHERE id = ?", args: [playlistTrackId] });
}

/** Swaps this track's sort_order with its neighbor in the given direction, scoped to its own playlist. */
export async function movePlaylistTrack(playlistId: string, playlistTrackId: string, direction: "up" | "down"): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT id, sort_order FROM playlist_tracks WHERE playlist_id = ? ORDER BY sort_order ASC",
    args: [playlistId],
  });
  const rows = r.rows.map((row) => ({ id: row.id as string, sortOrder: Number(row.sort_order ?? 0) }));
  const index = rows.findIndex((row) => row.id === playlistTrackId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await db.batch(
    [
      { sql: "UPDATE playlist_tracks SET sort_order = ? WHERE id = ?", args: [b.sortOrder, a.id] },
      { sql: "UPDATE playlist_tracks SET sort_order = ? WHERE id = ?", args: [a.sortOrder, b.id] },
    ],
    "write"
  );
}

// ---- Scenes --------------------------------------------------------------
// Creature library CRUD (listCreatures/getCreature/upsertCreature/
// deleteCreature/bulkImportCreatures) moved to creature-queries.ts
// (2026-07-12, same day) once it grew into a full Bestiary independent of
// Scenes - this file keeps only the scene_creatures/scene_characters
// membership functions below, which are Scenes-specific.
// A DM-defined "hotkey" for battle setup (2026-07-12) - see db/schema.sql's
// scenes/scene_creatures/scene_characters comment for the full design.
// Activated from the bot's /panel scenes (discord-bot/src/battle.ts).

async function uniqueSceneSlug(campaignId: string, name: string, excludeId?: string): Promise<string> {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "scene";
  let slug = base;
  let n = 2;
  const db = getDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.execute({ sql: "SELECT id FROM scenes WHERE campaign_id = ? AND slug = ?", args: [campaignId, slug] });
    const hit = r.rows[0];
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

function rowToScene(row: Record<string, unknown>): Scene {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    notes: (row.notes as string) ?? null,
    trackId: (row.track_id as string) ?? null,
    playlistId: (row.playlist_id as string) ?? null,
    shuffle: !!row.shuffle,
  };
}

export async function listScenes(campaignId: string): Promise<Scene[]> {
  await ensureSchema();
  const r = await getDb().execute({ sql: "SELECT * FROM scenes WHERE campaign_id = ? ORDER BY sort_order ASC, name ASC", args: [campaignId] });
  return r.rows.map(rowToScene);
}

export async function getSceneDetail(campaignId: string, sceneId: string): Promise<SceneDetail | null> {
  await ensureSchema();
  const db = getDb();
  const sceneRow = await db.execute({ sql: "SELECT * FROM scenes WHERE id = ? AND campaign_id = ?", args: [sceneId, campaignId] });
  const s = sceneRow.rows[0];
  if (!s) return null;

  const creaturesResult = await db.execute({
    sql: "SELECT * FROM scene_creatures WHERE scene_id = ? ORDER BY sort_order ASC",
    args: [sceneId],
  });
  const creatures: SceneCreatureItem[] = creaturesResult.rows.map((row) => ({
    id: row.id as string,
    creatureId: (row.creature_id as string) ?? null,
    name: row.name as string,
    hp: row.hp === null || row.hp === undefined ? null : Number(row.hp),
    ac: row.ac === null || row.ac === undefined ? null : Number(row.ac),
    initBonus: Number(row.init_bonus ?? 0),
    quantity: Number(row.quantity ?? 1),
    sortOrder: Number(row.sort_order ?? 0),
  }));

  const charactersResult = await db.execute({
    sql: `SELECT sc.id, sc.character_id, c.name, c.portrait_path
          FROM scene_characters sc JOIN characters c ON c.id = sc.character_id
          WHERE sc.scene_id = ? ORDER BY sc.sort_order ASC`,
    args: [sceneId],
  });
  const characters: SceneCharacterItem[] = charactersResult.rows.map((row) => ({
    id: row.id as string,
    characterId: row.character_id as string,
    name: row.name as string,
    portraitPath: (row.portrait_path as string) ?? null,
  }));

  return { ...rowToScene(s), creatures, characters };
}

export interface SceneSettingsInput {
  name: string;
  notes?: string;
  trackId?: string | null;
  playlistId?: string | null;
  shuffle?: boolean;
}

export async function createScene(campaignId: string, name: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const slug = await uniqueSceneSlug(campaignId, name);
  const id = newId();
  await db.execute({ sql: "INSERT INTO scenes (id, campaign_id, slug, name) VALUES (?,?,?,?)", args: [id, campaignId, slug, name] });
  return id;
}

/** Updates everything about a scene except its creature/character lists (those have their own add/remove functions below). */
export async function updateSceneSettings(campaignId: string, sceneId: string, input: SceneSettingsInput): Promise<void> {
  await ensureSchema();
  const slug = await uniqueSceneSlug(campaignId, input.name, sceneId);
  // A scene links a track OR a playlist, never both - see the CHECK in
  // schema.sql. Whichever one is set here, explicitly null out the other
  // rather than trusting the caller not to send both.
  const trackId = input.playlistId ? null : input.trackId ?? null;
  const playlistId = input.trackId ? null : input.playlistId ?? null;
  await getDb().execute({
    sql: `UPDATE scenes SET name=?, slug=?, notes=?, track_id=?, playlist_id=?, shuffle=?, updated_at=datetime('now')
          WHERE id=? AND campaign_id=?`,
    args: [input.name, slug, input.notes ?? null, trackId, playlistId, input.shuffle ? 1 : 0, sceneId, campaignId],
  });
}

export async function deleteScene(campaignId: string, sceneId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM scenes WHERE id = ? AND campaign_id = ?", args: [sceneId, campaignId] });
}

/** Adds a creature FROM THE LIBRARY, snapshotting its current stats so later library edits don't retroactively change this scene. */
export async function addLibraryCreatureToScene(campaignId: string, sceneId: string, creatureId: string, quantity: number): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const creature = await getCreature(campaignId, creatureId);
  if (!creature) throw new Error("That creature no longer exists.");
  const existing = await db.execute({ sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM scene_creatures WHERE scene_id = ?", args: [sceneId] });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  await db.execute({
    sql: `INSERT INTO scene_creatures (id, scene_id, creature_id, name, hp, ac, init_bonus, quantity, sort_order)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [newId(), sceneId, creatureId, creature.name, creature.hp, creature.ac, creature.initBonus, Math.max(1, quantity), nextOrder],
  });
}

/** Adds a one-off creature typed fresh for this scene, not tied to the library. */
export interface AdHocCreatureInput {
  name: string;
  hp?: number | null;
  ac?: number | null;
  initBonus?: number;
  quantity?: number;
}

export async function addAdHocCreatureToScene(sceneId: string, input: AdHocCreatureInput): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({ sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM scene_creatures WHERE scene_id = ?", args: [sceneId] });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  await db.execute({
    sql: `INSERT INTO scene_creatures (id, scene_id, creature_id, name, hp, ac, init_bonus, quantity, sort_order)
          VALUES (?,?,NULL,?,?,?,?,?,?)`,
    args: [newId(), sceneId, input.name, input.hp ?? null, input.ac ?? null, input.initBonus ?? 0, Math.max(1, input.quantity ?? 1), nextOrder],
  });
}

export async function removeSceneCreature(sceneCreatureId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM scene_creatures WHERE id = ?", args: [sceneCreatureId] });
}

export async function addCharacterToScene(sceneId: string, characterId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute({ sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM scene_characters WHERE scene_id = ?", args: [sceneId] });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  await db.execute({
    sql: "INSERT OR IGNORE INTO scene_characters (id, scene_id, character_id, sort_order) VALUES (?,?,?,?)",
    args: [newId(), sceneId, characterId, nextOrder],
  });
}

export async function removeSceneCharacter(sceneCharacterId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM scene_characters WHERE id = ?", args: [sceneCharacterId] });
}

// ---------------------------------------------------------------------------
// Discord bot configuration suite (2026-08-06). Three parts, all edited from
// /admin/discord: message routing (discord_settings), the custom-command
// builder (custom_commands/command_buttons), and custom masks (custom_masks).
// See the design comment in db/schema.sql. The bot reads all of it through
// its own mirror queries (discord-bot/src/db.ts) and re-registers guild
// slash commands whenever discord_settings.commands_version changes.
// ---------------------------------------------------------------------------

export async function getDiscordSettings(campaignId: string): Promise<DiscordSettings> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM discord_settings WHERE campaign_id = ?",
    args: [campaignId],
  });
  const row = r.rows[0];
  if (!row) return { campaignId, notifyReveals: false, rollChannelId: null, commandsVersion: 0 };
  return {
    campaignId,
    notifyReveals: !!row.notify_reveals,
    rollChannelId: (row.roll_channel_id as string) ?? null,
    commandsVersion: Number(row.commands_version ?? 0),
  };
}

export async function updateDiscordMessageSettings(
  campaignId: string,
  input: { notifyReveals: boolean; rollChannelId: string | null }
): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO discord_settings (campaign_id, notify_reveals, roll_channel_id)
          VALUES (?, ?, ?)
          ON CONFLICT(campaign_id) DO UPDATE SET
            notify_reveals = excluded.notify_reveals,
            roll_channel_id = excluded.roll_channel_id,
            updated_at = datetime('now')`,
    args: [campaignId, input.notifyReveals ? 1 : 0, input.rollChannelId],
  });
}

/** Signals the bot's sync loop that this campaign's guild commands changed. */
async function bumpCommandsVersion(campaignId: string): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO discord_settings (campaign_id, commands_version)
          VALUES (?, 1)
          ON CONFLICT(campaign_id) DO UPDATE SET
            commands_version = discord_settings.commands_version + 1,
            updated_at = datetime('now')`,
    args: [campaignId],
  });
}

/** The linked guild's text channels, as last snapshotted by the bot. Empty
 *  until the bot has been online with the new sync code at least once. */
export async function listGuildChannels(campaignId: string): Promise<GuildChannelInfo[]> {
  await ensureSchema();
  const link = await getGuildLinkForCampaign(campaignId);
  if (!link) return [];
  const r = await getDb().execute({
    sql: "SELECT * FROM guild_channels WHERE guild_id = ? ORDER BY position ASC, name ASC",
    args: [link.guildId],
  });
  return r.rows.map((row) => ({
    channelId: row.channel_id as string,
    guildId: row.guild_id as string,
    name: row.name as string,
    position: Number(row.position ?? 0),
  }));
}

// ---- Custom commands -------------------------------------------------------

/** Built-in command names the bot registers globally - a custom command may
 *  never shadow one. Keep in sync with discord-bot/src/register-commands.ts. */
export const RESERVED_COMMAND_NAMES = ["link", "panel", "stopmusic", "startbattle", "next", "endbattle"] as const;

/** Discord's slash-name rules (the subset we allow): 1-32 chars, lowercase
 *  letters/digits/hyphens. Returns null when nothing salvageable remains. */
export function sanitizeCommandName(raw: string): string | null {
  const name = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  if (!name) return null;
  if ((RESERVED_COMMAND_NAMES as readonly string[]).includes(name)) return null;
  return name;
}

/** A stored button action is a claim, not a fact - coerce to a known shape
 *  or reject. Mirrored (read side) in discord-bot/src/db.ts. */
export function sanitizeCommandAction(raw: unknown): CommandButtonAction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
  if (o.kind === "entity") {
    const entityType = str(o.entityType, 40);
    const entityId = str(o.entityId, 64);
    if (!entityType || !entityId) return null;
    if (!["characters", "locations", "factions", "artifacts", "creatures"].includes(entityType)) return null;
    return { kind: "entity", entityType: entityType as "characters", entityId };
  }
  if (o.kind === "text") {
    const text = str(o.text, 1800);
    if (!text) return null;
    const imageUrl = typeof o.imageUrl === "string" && /^https?:\/\//i.test(o.imageUrl) ? o.imageUrl.slice(0, 500) : undefined;
    return { kind: "text", text, ...(imageUrl ? { imageUrl } : {}) };
  }
  if (o.kind === "roll") {
    const characterId = str(o.characterId, 64);
    const label = str(o.label, 60) ?? "Roll";
    if (!characterId) return null;
    const part = (v: unknown): number | string | null => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
      if (typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(v)) return v;
      return null;
    };
    const count = part(o.count) ?? 1;
    const die = part(o.die) ?? 20;
    const modifiers = Array.isArray(o.modifiers)
      ? o.modifiers.map(part).filter((m): m is number | string => m !== null).slice(0, 8)
      : [];
    return { kind: "roll", characterId, label, count, die, modifiers };
  }
  if (o.kind === "status") {
    const targetType = str(o.targetType, 20);
    const targetId = str(o.targetId, 64);
    if (!targetId || (targetType !== "character" && targetType !== "creature")) return null;
    return { kind: "status", targetType, targetId };
  }
  return null;
}

function rowToCommand(row: Record<string, unknown>): CustomCommand {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    enabled: !!row.enabled,
  };
}

function rowToButton(row: Record<string, unknown>): CommandButton {
  let action: CommandButtonAction | null = null;
  try {
    action = sanitizeCommandAction(JSON.parse((row.action as string) || "{}"));
  } catch {
    action = null;
  }
  const styleRaw = row.style as string;
  const style: CommandButtonStyle = ["primary", "secondary", "success", "danger"].includes(styleRaw)
    ? (styleRaw as CommandButtonStyle)
    : "secondary";
  return {
    id: row.id as string,
    commandId: row.command_id as string,
    label: (row.label as string) ?? "Button",
    style,
    action,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function listCustomCommands(campaignId: string): Promise<CustomCommandDetail[]> {
  await ensureSchema();
  const db = getDb();
  const cmds = await db.execute({
    sql: "SELECT * FROM custom_commands WHERE campaign_id = ? ORDER BY name ASC",
    args: [campaignId],
  });
  const out: CustomCommandDetail[] = [];
  for (const row of cmds.rows) {
    const buttons = await db.execute({
      sql: "SELECT * FROM command_buttons WHERE command_id = ? ORDER BY sort_order ASC, created_at ASC",
      args: [row.id as string],
    });
    out.push({ ...rowToCommand(row), buttons: buttons.rows.map(rowToButton) });
  }
  return out;
}

export async function createCustomCommand(campaignId: string, rawName: string, description: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensureSchema();
  const name = sanitizeCommandName(rawName);
  if (!name) return { ok: false, error: "Command names use lowercase letters, digits and hyphens (and can't shadow a built-in like /panel)." };
  const db = getDb();
  const dup = await db.execute({ sql: "SELECT id FROM custom_commands WHERE campaign_id = ? AND name = ?", args: [campaignId, name] });
  if (dup.rows[0]) return { ok: false, error: `/${name} already exists in this campaign.` };
  const count = await db.execute({ sql: "SELECT COUNT(*) AS n FROM custom_commands WHERE campaign_id = ?", args: [campaignId] });
  if (Number(count.rows[0]?.n ?? 0) >= 25) return { ok: false, error: "At most 25 custom commands per campaign (Discord's own guild-command ceiling leaves room for growth)." };
  const id = newId();
  await db.execute({
    sql: "INSERT INTO custom_commands (id, campaign_id, name, description) VALUES (?,?,?,?)",
    args: [id, campaignId, name, description.slice(0, 100)],
  });
  await bumpCommandsVersion(campaignId);
  return { ok: true, id };
}

export async function updateCustomCommand(
  campaignId: string,
  commandId: string,
  input: { name: string; description: string; enabled: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  const name = sanitizeCommandName(input.name);
  if (!name) return { ok: false, error: "Command names use lowercase letters, digits and hyphens (and can't shadow a built-in like /panel)." };
  const db = getDb();
  const dup = await db.execute({
    sql: "SELECT id FROM custom_commands WHERE campaign_id = ? AND name = ? AND id != ?",
    args: [campaignId, name, commandId],
  });
  if (dup.rows[0]) return { ok: false, error: `/${name} already exists in this campaign.` };
  await db.execute({
    sql: "UPDATE custom_commands SET name=?, description=?, enabled=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
    args: [name, input.description.slice(0, 100), input.enabled ? 1 : 0, commandId, campaignId],
  });
  await bumpCommandsVersion(campaignId);
  return { ok: true };
}

export async function deleteCustomCommand(campaignId: string, commandId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM custom_commands WHERE id = ? AND campaign_id = ?", args: [commandId, campaignId] });
  await bumpCommandsVersion(campaignId);
}

/** Ownership guard shared by the button actions: the button's command must
 *  belong to this campaign, or the write silently refuses. */
async function commandBelongsTo(campaignId: string, commandId: string): Promise<boolean> {
  const r = await getDb().execute({
    sql: "SELECT id FROM custom_commands WHERE id = ? AND campaign_id = ?",
    args: [commandId, campaignId],
  });
  return !!r.rows[0];
}

export async function addCommandButton(
  campaignId: string,
  commandId: string,
  label: string,
  style: CommandButtonStyle,
  action: CommandButtonAction
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensureSchema();
  if (!(await commandBelongsTo(campaignId, commandId))) return { ok: false, error: "That command no longer exists." };
  const clean = sanitizeCommandAction(action);
  if (!clean) return { ok: false, error: "That button's action is incomplete." };
  const db = getDb();
  const count = await db.execute({ sql: "SELECT COUNT(*) AS n FROM command_buttons WHERE command_id = ?", args: [commandId] });
  if (Number(count.rows[0]?.n ?? 0) >= 25) return { ok: false, error: "At most 25 buttons per command (Discord caps a message at 5 rows of 5)." };
  const existing = await db.execute({ sql: "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM command_buttons WHERE command_id = ?", args: [commandId] });
  const nextOrder = Number(existing.rows[0]?.maxOrder ?? -1) + 1;
  const id = newId();
  await db.execute({
    sql: "INSERT INTO command_buttons (id, command_id, label, style, action, sort_order) VALUES (?,?,?,?,?,?)",
    args: [id, commandId, label.slice(0, 80) || "Button", style, JSON.stringify(clean), nextOrder],
  });
  await bumpCommandsVersion(campaignId);
  return { ok: true, id };
}

export async function updateCommandButton(
  campaignId: string,
  commandId: string,
  buttonId: string,
  label: string,
  style: CommandButtonStyle,
  action: CommandButtonAction
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  if (!(await commandBelongsTo(campaignId, commandId))) return { ok: false, error: "That command no longer exists." };
  const clean = sanitizeCommandAction(action);
  if (!clean) return { ok: false, error: "That button's action is incomplete." };
  await getDb().execute({
    sql: "UPDATE command_buttons SET label=?, style=?, action=? WHERE id=? AND command_id=?",
    args: [label.slice(0, 80) || "Button", style, JSON.stringify(clean), buttonId, commandId],
  });
  await bumpCommandsVersion(campaignId);
  return { ok: true };
}

export async function removeCommandButton(campaignId: string, commandId: string, buttonId: string): Promise<void> {
  await ensureSchema();
  if (!(await commandBelongsTo(campaignId, commandId))) return;
  await getDb().execute({ sql: "DELETE FROM command_buttons WHERE id = ? AND command_id = ?", args: [buttonId, commandId] });
  await bumpCommandsVersion(campaignId);
}

/** Swaps this button's sort_order with its neighbor - same pattern as playlist tracks. */
export async function moveCommandButton(campaignId: string, commandId: string, buttonId: string, direction: "up" | "down"): Promise<void> {
  await ensureSchema();
  if (!(await commandBelongsTo(campaignId, commandId))) return;
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT id, sort_order FROM command_buttons WHERE command_id = ? ORDER BY sort_order ASC, created_at ASC",
    args: [commandId],
  });
  const rows = r.rows.map((row) => ({ id: row.id as string, sortOrder: Number(row.sort_order ?? 0) }));
  const index = rows.findIndex((row) => row.id === buttonId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;
  const a = rows[index];
  const b = rows[swapIndex];
  await db.batch(
    [
      { sql: "UPDATE command_buttons SET sort_order = ? WHERE id = ?", args: [b.sortOrder, a.id] },
      { sql: "UPDATE command_buttons SET sort_order = ? WHERE id = ?", args: [a.sortOrder, b.id] },
    ],
    "write"
  );
  await bumpCommandsVersion(campaignId);
}

// ---- Custom masks ----------------------------------------------------------

function rowToCustomMask(row: Record<string, unknown>): CustomMask {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    mask: row.mask as string,
    displayName: row.display_name as string,
    avatarPath: (row.avatar_path as string) ?? null,
  };
}

export async function listCustomMasks(campaignId: string): Promise<CustomMask[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM custom_masks WHERE campaign_id = ? ORDER BY mask ASC",
    args: [campaignId],
  });
  return r.rows.map(rowToCustomMask);
}

/** A mask word must be unique across BOTH character masks and custom masks
 *  in the campaign (case-insensitive) - the bot resolves characters first,
 *  so a collision would shadow one or the other confusingly. */
async function maskWordTaken(campaignId: string, mask: string, excludeCustomId?: string): Promise<string | null> {
  const db = getDb();
  const ch = await db.execute({
    sql: "SELECT name FROM characters WHERE campaign_id = ? AND lower(mask) = lower(?)",
    args: [campaignId, mask],
  });
  if (ch.rows[0]) return `the character ${ch.rows[0].name as string} already uses that mask`;
  const cm = await db.execute({
    sql: "SELECT id, display_name FROM custom_masks WHERE campaign_id = ? AND lower(mask) = lower(?)",
    args: [campaignId, mask],
  });
  const hit = cm.rows[0];
  if (hit && hit.id !== excludeCustomId) return `the custom mask ${hit.display_name as string} already uses that word`;
  return null;
}

export interface CustomMaskInput {
  mask: string;
  displayName: string;
  avatarFile?: File | null;
}

export async function upsertCustomMask(
  campaignId: string,
  input: CustomMaskInput,
  id?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensureSchema();
  const mask = input.mask.trim().slice(0, 60);
  const displayName = input.displayName.trim().slice(0, 80);
  if (!mask || !displayName) return { ok: false, error: "A mask needs both a trigger word and a display name." };
  if (/[\[\]:]/.test(mask)) return { ok: false, error: "Mask words can't contain [, ] or : - they'd break the [[mask]]: trigger." };
  const taken = await maskWordTaken(campaignId, mask, id);
  if (taken) return { ok: false, error: `Can't use [[${mask}]] - ${taken}.` };
  let avatarPath: string | undefined;
  if (input.avatarFile && input.avatarFile.size > 0) {
    avatarPath = await uploadImage(input.avatarFile, "masks");
  }
  const db = getDb();
  if (id) {
    if (avatarPath) {
      await db.execute({
        sql: "UPDATE custom_masks SET mask=?, display_name=?, avatar_path=? WHERE id=? AND campaign_id=?",
        args: [mask, displayName, avatarPath, id, campaignId],
      });
    } else {
      await db.execute({
        sql: "UPDATE custom_masks SET mask=?, display_name=? WHERE id=? AND campaign_id=?",
        args: [mask, displayName, id, campaignId],
      });
    }
    return { ok: true, id };
  }
  const newMaskId = newId();
  await db.execute({
    sql: "INSERT INTO custom_masks (id, campaign_id, mask, display_name, avatar_path) VALUES (?,?,?,?,?)",
    args: [newMaskId, campaignId, mask, displayName, avatarPath ?? null],
  });
  return { ok: true, id: newMaskId };
}

export async function deleteCustomMask(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM custom_masks WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}
