-- The Erendyl Codex - Player-Facing Website
-- Standalone schema, independent of the DM's desktop Codex app.
-- Every content table carries `revealed` (0/1) so Aviv controls exactly
-- what players can see; the admin panel can flip it on as the campaign
-- reveals more. Ids are app-generated UUID strings.
--
-- Multi-campaign: every content table also carries campaign_id, so Aviv can
-- run more than one game with completely isolated data. Uniqueness on slug/
-- name is scoped per campaign (UNIQUE(campaign_id, slug), not a bare slug
-- UNIQUE) so two campaigns can both have e.g. a location called "Camor"
-- without colliding. See src/lib/db.ts's runMigrations() for how existing
-- (pre-campaign) databases get migrated onto this schema safely.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moons (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  cycle       TEXT,
  domain      TEXT NOT NULL,
  description TEXT NOT NULL,
  color       TEXT,
  is_goddess  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug),
  UNIQUE (campaign_id, name)
);
CREATE INDEX IF NOT EXISTS idx_moons_campaign ON moons(campaign_id);

CREATE TABLE IF NOT EXISTS regions (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  capital     TEXT,
  government  TEXT,
  faith       TEXT,
  moon_id     TEXT REFERENCES moons(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  revealed    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug),
  UNIQUE (campaign_id, name)
);
CREATE INDEX IF NOT EXISTS idx_regions_moon ON regions(moon_id);
CREATE INDEX IF NOT EXISTS idx_regions_campaign ON regions(campaign_id);

CREATE TABLE IF NOT EXISTS locations (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL, -- City, District, Landmark, Ruin, Dungeon, Region
  parent_id      TEXT REFERENCES locations(id) ON DELETE SET NULL,
  region_id      TEXT REFERENCES regions(id) ON DELETE SET NULL,
  description    TEXT NOT NULL,
  thumbnail_path TEXT,
  revealed       INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_region ON locations(region_id);
CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);

CREATE TABLE IF NOT EXISTS factions (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  region_id   TEXT REFERENCES regions(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  goals       TEXT,
  notes       TEXT,
  revealed    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug),
  UNIQUE (campaign_id, name)
);
CREATE INDEX IF NOT EXISTS idx_factions_region ON factions(region_id);
CREATE INDEX IF NOT EXISTS idx_factions_campaign ON factions(campaign_id);

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_pc         INTEGER NOT NULL DEFAULT 0,
  is_alive      INTEGER NOT NULL DEFAULT 1,
  race          TEXT,
  char_class    TEXT,
  status        TEXT,
  summary       TEXT NOT NULL,
  bio           TEXT NOT NULL,
  tags          TEXT,
  portrait_path TEXT,
  revealed      INTEGER NOT NULL DEFAULT 1,
  location_id   TEXT REFERENCES locations(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(location_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);
CREATE INDEX IF NOT EXISTS idx_characters_campaign ON characters(campaign_id);

CREATE TABLE IF NOT EXISTS character_factions (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  faction_id   TEXT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  role         TEXT,
  UNIQUE(character_id, faction_id)
);
CREATE INDEX IF NOT EXISTS idx_charfac_char ON character_factions(character_id);
CREATE INDEX IF NOT EXISTS idx_charfac_fac ON character_factions(faction_id);

CREATE TABLE IF NOT EXISTS storylines (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL, -- Active, Dormant, Resolved, Background
  priority    TEXT,
  summary     TEXT NOT NULL,
  description TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  next_step   TEXT,
  revealed    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_storylines_location ON storylines(location_id);
CREATE INDEX IF NOT EXISTS idx_storylines_campaign ON storylines(campaign_id);

CREATE TABLE IF NOT EXISTS storyline_characters (
  id           TEXT PRIMARY KEY,
  storyline_id TEXT NOT NULL REFERENCES storylines(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role         TEXT,
  UNIQUE(storyline_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_storychar_story ON storyline_characters(storyline_id);
CREATE INDEX IF NOT EXISTS idx_storychar_char ON storyline_characters(character_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id                 TEXT PRIMARY KEY,
  campaign_id        TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL,
  rarity             TEXT,
  attunement         INTEGER NOT NULL DEFAULT 0,
  owner_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  location_id        TEXT REFERENCES locations(id) ON DELETE SET NULL,
  description        TEXT NOT NULL,
  mechanics          TEXT,
  image_path         TEXT,
  revealed           INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_character_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_location ON artifacts(location_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_campaign ON artifacts(campaign_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  in_world_date  TEXT,
  sort_index     INTEGER NOT NULL,
  session_number INTEGER,
  event_type     TEXT NOT NULL, -- Session, Backstory, World Event, Revelation
  location_id    TEXT REFERENCES locations(id) ON DELETE SET NULL,
  storyline_id   TEXT REFERENCES storylines(id) ON DELETE SET NULL,
  revealed       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_sort ON timeline_events(sort_index);
CREATE INDEX IF NOT EXISTS idx_events_location ON timeline_events(location_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON timeline_events(campaign_id);

CREATE TABLE IF NOT EXISTS timeline_event_characters (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE(event_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_evtchar_evt ON timeline_event_characters(event_id);
CREATE INDEX IF NOT EXISTS idx_evtchar_char ON timeline_event_characters(character_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------------------
-- Player accounts. One account per player, created and managed by the DM
-- from /admin/players, always within the currently-selected campaign.
-- Optionally linked to their PC in `characters` so their character sheet
-- and "my character" view can be found. Usernames stay globally unique
-- (simplest, and fine at this scale) even though accounts are per-campaign.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  character_id  TEXT REFERENCES characters(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_players_character ON players(character_id);
CREATE INDEX IF NOT EXISTS idx_players_campaign ON players(campaign_id);

-- ---------------------------------------------------------------------------
-- Per-player visibility. A revealed entity with zero rows here is visible to
-- every logged-in player in that entity's campaign. A revealed entity WITH
-- rows here is restricted: only the listed players can see it. This is the
-- whole-entity half of the visibility model - the in-text half is the
-- <GM approved="username,username"> tag, parsed at read time by
-- src/lib/gm-tags.ts and never sent to unapproved viewers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_player_access (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(entity_type, entity_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_epa_entity ON entity_player_access(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_epa_player ON entity_player_access(player_id);
CREATE INDEX IF NOT EXISTS idx_epa_campaign ON entity_player_access(campaign_id);

-- ---------------------------------------------------------------------------
-- Editable player character sheets (full 2014 5e template). One row per
-- character, stored as a single JSON blob rather than one column per stat -
-- the sheet has dozens of interrelated fields (skills, saves, spell slots,
-- attacks) and JSON keeps this maintainable while the whole thing is still
-- fully editable through the form in CharacterSheetForm.tsx. A player can
-- edit their own linked character's sheet from /me/sheet; the DM can edit
-- any sheet from /admin/characters/[id]/sheet. Scoped implicitly through
-- character_id, which is already campaign-scoped - no campaign_id needed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_sheets (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_character_sheets_character ON character_sheets(character_id);

-- ---------------------------------------------------------------------------
-- Maps. Each map is one uploaded image (stored in Vercel Blob storage in
-- production, or public/uploads/maps locally). Pins are placed at fractional
-- (0..1) coordinates so they stay correctly positioned at any render size,
-- and each pin can link to another map - clicking it in the public explorer
-- triggers a client-side zoom animation into that target map, no reload.
-- Maps share the same revealed/entity_player_access visibility model as
-- every other content table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maps (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  is_root     INTEGER NOT NULL DEFAULT 0,
  revealed    INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_maps_location ON maps(location_id);
CREATE INDEX IF NOT EXISTS idx_maps_campaign ON maps(campaign_id);

CREATE TABLE IF NOT EXISTS map_pins (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  label         TEXT,
  icon          TEXT,
  target_map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_map_pins_map ON map_pins(map_id);
CREATE INDEX IF NOT EXISTS idx_map_pins_target ON map_pins(target_map_id);

-- ---------------------------------------------------------------------------
-- Map regions: rectangular areas (fractional 0..1 coords, like pins) drawn on
-- a map's image and tied to a Location. Used purely to auto-place character
-- tokens - see resolveCharacterTokens() in queries.ts: a character's token is
-- placed in the region for their exact location, or (walking up parent_id)
-- the nearest ancestor location that has a region on THIS map. Multiple
-- regions can point at the same location (e.g. a sprawling location drawn as
-- two disconnected areas) and a map can have zero regions, in which case no
-- character ever auto-places on it. Admin-only concept - players never see
-- the region boxes, only the resulting tokens.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_regions (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  width       REAL NOT NULL,
  height      REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_map_regions_map ON map_regions(map_id);
CREATE INDEX IF NOT EXISTS idx_map_regions_location ON map_regions(location_id);

-- ---------------------------------------------------------------------------
-- Manual per-map character token placement. Set by the DM dragging a token
-- in the admin map editor; overrides the automatic region-based placement
-- for that one character on that one map. No row here = position is
-- computed automatically from map_regions instead (see resolveCharacterTokens
-- in queries.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_map_positions (
  id           TEXT PRIMARY KEY,
  map_id       TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (map_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_char_map_pos_map ON character_map_positions(map_id);
CREATE INDEX IF NOT EXISTS idx_char_map_pos_char ON character_map_positions(character_id);

-- ---------------------------------------------------------------------------
-- DM-defined Sections. A Section is a custom player-facing page (its own
-- header + slug) that the DM composes out of one or more Article Lists, each
-- list showing a curated, ordered set of existing entities of ONE built-in
-- type (characters, locations, factions, storylines, artifacts, or regions -
-- see SECTION_ENTITY_TYPES in types.ts). This is Phase 1 of Aviv's "Section
-- Creator" idea: composing existing content into new pages. Phase 2 (later)
-- adds fully custom article types via a template system; article_list_items
-- deliberately has no foreign key on entity_id since it can point into six
-- different tables depending on the list's entity_type - membership is only
-- as durable as the referenced row, so a deleted entity's item row just
-- resolves to nothing and is silently skipped when rendering (see
-- resolveArticleSummaries in queries.ts), never treated as an error.
-- Sections share the same revealed / entity_player_access visibility model as
-- every other content table; the underlying entities' own visibility and
-- GM-tag redaction still apply on top when a list is rendered.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sections (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  revealed    INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_sections_campaign ON sections(campaign_id);

CREATE TABLE IF NOT EXISTS article_lists (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_lists_section ON article_lists(section_id);

CREATE TABLE IF NOT EXISTS article_list_items (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES article_lists(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_article_list_items_list ON article_list_items(list_id);

-- ---------------------------------------------------------------------------
-- Journals. Every character (PC or NPC) has an implicit journal made up of
-- dated entries "written" by that character's owner - the DM for NPCs, the
-- linked player for their own PC (and always the DM too). This is private
-- data, never subject to the public revealed/entity_player_access model:
-- access is enforced purely by ownership (DM sees everything; a player sees
-- only the journal of the character linked to their account). Scoped
-- implicitly through owner_character_id, which is already campaign-scoped.
--
-- Two categories, matching Aviv's spec:
--   'event'   - general dated log entries (session notes, what happened),
--               not tied to any other character. subject_character_id is
--               NULL.
--   'contact' - dated notes about a specific other character, with an
--               optional 1-6 trust snapshot at the time of writing so trust
--               can be seen evolving entry by entry. subject_character_id
--               is required. Multiple contact entries about the same
--               subject accumulate into a list, viewable grouped by subject.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
  id                    TEXT PRIMARY KEY,
  owner_character_id    TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  category              TEXT NOT NULL CHECK (category IN ('event', 'contact')),
  subject_character_id  TEXT REFERENCES characters(id) ON DELETE CASCADE,
  title                 TEXT,
  body                  TEXT NOT NULL DEFAULT '',
  trust_value           INTEGER,
  entry_date            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_owner ON journal_entries(owner_character_id, category);
CREATE INDEX IF NOT EXISTS idx_journal_subject ON journal_entries(owner_character_id, subject_character_id);

-- ---------------------------------------------------------------------------
-- DM Screen (the whiteboard). One continuous freeform board per campaign
-- where Aviv drops sticky notes, cheatsheets, and quick-link cards to any
-- existing article (characters, locations, factions, storylines, artifacts,
-- timeline events, maps, regions, moons) so everything needed to run a
-- session lives in one place. Admin-only, never exposed to players, never
-- subject to the revealed/entity_player_access model - it's DM prep, not
-- campaign content. entity_type/entity_id (only set on 'link' items)
-- deliberately has no FK, mirroring entity_player_access, since one column
-- can't reference nine different tables; if the linked entity is later
-- deleted, the board just shows a "no longer exists" placeholder for that
-- card instead of erroring.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_board_items (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('note', 'cheatsheet', 'link')),
  title       TEXT,
  body        TEXT,
  color       TEXT,
  entity_type TEXT,
  entity_id   TEXT,
  x           REAL NOT NULL DEFAULT 40,
  y           REAL NOT NULL DEFAULT 40,
  width       REAL NOT NULL DEFAULT 260,
  height      REAL NOT NULL DEFAULT 180,
  z_index     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_items_campaign ON dm_board_items(campaign_id);
