import { getDb, ensureSchema, newId } from "./db";
import { uploadImage } from "./blob-storage";
import type { MusicTrack, GuildLink, Playlist, PlaylistDetail, PlaylistTrackItem } from "./types";

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

export async function listMusicTracks(campaignId: string): Promise<MusicTrack[]> {
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT * FROM music_tracks WHERE campaign_id = ? ORDER BY name ASC",
    args: [campaignId],
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

async function uniqueTrackSlug(campaignId: string, name: string, excludeId?: string): Promise<string> {
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
      sql: "SELECT id FROM music_tracks WHERE campaign_id = ? AND slug = ?",
      args: [campaignId, slug],
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
  const slug = await uniqueTrackSlug(campaignId, input.name, id);
  const trackId = id ?? newId();
  let fileUrl = input.fileUrl;
  if (input.file && input.file.size > 0) {
    fileUrl = await uploadImage(input.file, "music");
  }
  if (id) {
    if (fileUrl) {
      await db.execute({
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, scene=?, file_url=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
        args: [input.name, slug, input.tags ?? null, input.scene ?? null, fileUrl, id, campaignId],
      });
    } else {
      await db.execute({
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, scene=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
        args: [input.name, slug, input.tags ?? null, input.scene ?? null, id, campaignId],
      });
    }
  } else {
    if (!fileUrl) throw new Error("A track file is required.");
    await db.execute({
      sql: "INSERT INTO music_tracks (id, campaign_id, slug, name, tags, scene, file_url) VALUES (?,?,?,?,?,?,?)",
      args: [trackId, campaignId, slug, input.name, input.tags ?? null, input.scene ?? null, fileUrl],
    });
  }
  return trackId;
}

export async function deleteMusicTrack(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM music_tracks WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
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
