import { getDb, ensureSchema, newId } from "./db";
import { uploadImage } from "./blob-storage";
import type { MusicTrack, GuildLink } from "./types";

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
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, file_url=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
        args: [input.name, slug, input.tags ?? null, fileUrl, id, campaignId],
      });
    } else {
      await db.execute({
        sql: "UPDATE music_tracks SET name=?, slug=?, tags=?, updated_at=datetime('now') WHERE id=? AND campaign_id=?",
        args: [input.name, slug, input.tags ?? null, id, campaignId],
      });
    }
  } else {
    if (!fileUrl) throw new Error("A track file is required.");
    await db.execute({
      sql: "INSERT INTO music_tracks (id, campaign_id, slug, name, tags, file_url) VALUES (?,?,?,?,?,?)",
      args: [trackId, campaignId, slug, input.name, input.tags ?? null, fileUrl],
    });
  }
  return trackId;
}

export async function deleteMusicTrack(campaignId: string, id: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM music_tracks WHERE id = ? AND campaign_id = ?", args: [id, campaignId] });
}
