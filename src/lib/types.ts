export interface Campaign {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Entity types that can be copied when creating a new campaign via
// "inherit from" - see src/lib/campaign-queries.ts. Order here matters
// for display only; the copy logic has its own internal dependency order.
export const INHERITABLE_ENTITY_TYPES = [
  "moons",
  "regions",
  "locations",
  "factions",
  "characters",
  "storylines",
  "artifacts",
  "timeline_events",
  "maps",
] as const;
export type InheritableEntityType = (typeof INHERITABLE_ENTITY_TYPES)[number];

export interface Moon {
  id: string;
  slug: string;
  name: string;
  cycle: string | null;
  domain: string;
  description: string;
  color: string | null;
  isGoddess: boolean;
  sortOrder: number;
}

export interface Region {
  id: string;
  slug: string;
  name: string;
  type: string;
  capital: string | null;
  government: string | null;
  faith: string | null;
  moonId: string | null;
  moonName?: string | null;
  description: string;
  color: string | null;
  sortOrder: number;
  revealed: boolean;
}

export interface Location {
  id: string;
  slug: string;
  name: string;
  type: string;
  parentId: string | null;
  parentName?: string | null;
  parentSlug?: string | null;
  regionId: string | null;
  regionName?: string | null;
  regionSlug?: string | null;
  description: string;
  thumbnailPath: string | null;
  revealed: boolean;
  notes: string | null;
}

export interface Character {
  id: string;
  slug: string;
  name: string;
  isPc: boolean;
  isAlive: boolean;
  race: string | null;
  charClass: string | null;
  status: string | null;
  summary: string;
  bio: string;
  tags: string | null;
  portraitPath: string | null;
  revealed: boolean;
  locationId: string | null;
  locationName?: string | null;
  locationSlug?: string | null;
  /** Discord bot bracket word - [[mask]]: ... - null if unset. See db/schema.sql. */
  mask: string | null;
}

export interface Faction {
  id: string;
  slug: string;
  name: string;
  type: string;
  regionId: string | null;
  regionName?: string | null;
  regionSlug?: string | null;
  description: string;
  goals: string | null;
  notes: string | null;
  revealed: boolean;
}

export interface Storyline {
  id: string;
  slug: string;
  title: string;
  status: string;
  priority: string | null;
  summary: string;
  description: string | null;
  locationId: string | null;
  locationName?: string | null;
  locationSlug?: string | null;
  nextStep: string | null;
  revealed: boolean;
}

export interface Artifact {
  id: string;
  slug: string;
  name: string;
  type: string;
  rarity: string | null;
  attunement: boolean;
  ownerCharacterId: string | null;
  ownerName?: string | null;
  ownerSlug?: string | null;
  locationId: string | null;
  locationName?: string | null;
  locationSlug?: string | null;
  description: string;
  mechanics: string | null;
  imagePath: string | null;
  revealed: boolean;
}

export interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  inWorldDate: string | null;
  sortIndex: number;
  sessionNumber: number | null;
  eventType: string;
  locationId: string | null;
  locationName?: string | null;
  locationSlug?: string | null;
  storylineId: string | null;
  revealed: boolean;
}

export interface CharacterSummary {
  id: string;
  slug: string;
  name: string;
  role?: string | null;
}

export interface Player {
  id: string;
  username: string;
  displayName: string;
  characterId: string | null;
  characterName?: string | null;
  characterSlug?: string | null;
  /** Linked Discord account (see /link + link_codes in db/schema.sql), null if not linked. */
  discordUserId: string | null;
}

// ---------------------------------------------------------------------------
// Discord bot (2026-07-06). See discord-io.ts for query functions and
// discord-bot/ for the standalone bot process that consumes them.
// ---------------------------------------------------------------------------

export interface MusicTrack {
  id: string;
  slug: string;
  name: string;
  tags: string | null;
  fileUrl: string;
}

export interface GuildLink {
  id: string;
  guildId: string;
  campaignId: string;
  linkedAt: string;
}

// ---------------------------------------------------------------------------
// Full 2014 5e character sheet (see character-sheet.ts for defaults / load /
// save). Stored as one JSON blob per character rather than one column per
// stat - the sheet has too many interrelated repeatable fields (skills,
// saves, spell slots, attacks, spells) for a flat table to stay sane.
// ---------------------------------------------------------------------------

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type SkillKey =
  | "acrobatics"
  | "animalHandling"
  | "arcana"
  | "athletics"
  | "deception"
  | "history"
  | "insight"
  | "intimidation"
  | "investigation"
  | "medicine"
  | "nature"
  | "perception"
  | "performance"
  | "persuasion"
  | "religion"
  | "sleightOfHand"
  | "stealth"
  | "survival";

export interface SkillProficiency {
  proficient: boolean;
  expertise: boolean;
}

export interface AttackEntry {
  name: string;
  atkBonus: string;
  damage: string;
}

export interface SpellEntry {
  level: number;
  name: string;
  prepared: boolean;
}

export interface SpellSlotLevel {
  total: number;
  used: number;
}

export interface CharacterSheetData {
  playerName: string;
  race: string;
  classLevel: string;
  background: string;
  alignment: string;
  experiencePoints: number;

  abilityScores: Record<AbilityKey, number>;
  inspiration: boolean;
  proficiencyBonus: number;

  savingThrows: Record<AbilityKey, boolean>;
  skills: Record<SkillKey, SkillProficiency>;

  armorClass: number;
  initiativeMisc: number;
  speed: number;

  hitPointMax: number;
  hitPointCurrent: number;
  hitPointTemp: number;
  hitDiceTotal: string;
  hitDiceCurrent: string;
  deathSaveSuccesses: number;
  deathSaveFailures: number;

  attacks: AttackEntry[];

  equipment: string;
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };

  proficienciesLanguages: string;
  featuresTraits: string;

  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;

  spellcastingClass: string;
  spellcastingAbility: AbilityKey | "";
  spellSlots: Record<string, SpellSlotLevel>;
  spells: SpellEntry[];
}

// ---------------------------------------------------------------------------
// Maps & pins. See queries.ts / admin-queries.ts for read/write and
// MapExplorer.tsx / MapPinEditor.tsx for the public and admin UI.
// ---------------------------------------------------------------------------

export interface MapPin {
  id: string;
  mapId: string;
  x: number;
  y: number;
  label: string | null;
  icon: string | null;
  targetMapId: string | null;
  targetMapSlug?: string | null;
  targetMapName?: string | null;
}

// A single fractional (0..1) vertex of a map region polygon.
export interface MapRegionPoint {
  x: number;
  y: number;
}

export interface MapEntity {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  locationId: string | null;
  locationName?: string | null;
  locationSlug?: string | null;
  isRoot: boolean;
  revealed: boolean;
  sortOrder: number;
  pins?: MapPin[];
  tokens?: CharacterMapToken[];
}

// Admin-only editing concept: an arbitrary polygon (fractional 0..1 coords,
// like pins) tied to a Location, used purely to auto-place character tokens.
// Never sent to the public site - see MapRegionEditor.tsx / getMapRegions in
// admin-queries.ts.
export interface MapRegion {
  id: string;
  mapId: string;
  locationId: string;
  locationName?: string | null;
  points: MapRegionPoint[];
}

// A resolved, ready-to-render character token for one specific map: either
// auto-placed via MapRegion + the location parent-chain fallback, or an
// admin-set manual override. See resolveCharacterTokens() in queries.ts.
export interface CharacterMapToken {
  characterId: string;
  name: string;
  slug: string;
  summary: string;
  portraitPath: string | null;
  x: number;
  y: number;
}

// A character available to be placed on a given map in the admin editor,
// alongside its current resolved position (if any) and whether that position
// is a manual override or auto-computed from regions.
export interface AdminCharacterMapToken {
  characterId: string;
  name: string;
  portraitPath: string | null;
  x: number | null;
  y: number | null;
  isOverride: boolean;
}

// ---------------------------------------------------------------------------
// DM-defined Sections (Phase 1 of the "Section Creator"). See queries.ts /
// admin-queries.ts for read/write and src/app/sections/[slug]/page.tsx +
// src/app/admin/sections for the public and admin UI. A Section is a custom
// player-facing page composed of one or more Article Lists, each list
// curating an ordered set of EXISTING entities of one built-in type. Fully
// custom article types (via a template editor) are a later phase.
// ---------------------------------------------------------------------------

// The six built-in entity types an Article List could bind to as of Phase 1.
// Phase 2 adds a seventh possibility, "custom", for lists bound to a
// DM-authored Template instead (see templateId below) - kept as a separate
// literal rather than folded into this const array since a handful of call
// sites (the create-list validation, the built-in "+ Add List" picker)
// specifically need "just the six built-ins" without custom mixed in.
export const SECTION_ENTITY_TYPES = [
  "characters",
  "locations",
  "factions",
  "storylines",
  "artifacts",
  "regions",
] as const;
export type BuiltinSectionEntityType = (typeof SECTION_ENTITY_TYPES)[number];
export type SectionEntityType = BuiltinSectionEntityType | "custom";

export interface Section {
  id: string;
  slug: string;
  name: string;
  revealed: boolean;
  sortOrder: number;
}

// A resolved, ready-to-render summary of one entity as it should appear
// inside an Article List card - shape is uniform across every underlying
// entity type so the public page can render them with one generic card
// component, regardless of which table the entity actually lives in.
export interface ArticleListItemSummary {
  entityId: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imagePath?: string | null;
  href: string;
}

export interface ArticleList {
  id: string;
  sectionId: string;
  entityType: SectionEntityType;
  // Only set (non-null) when entityType === "custom" - identifies which
  // global Template every item in this list is an instance of.
  templateId?: string | null;
  name: string;
  sortOrder: number;
  items: ArticleListItemSummary[];
}

export interface SectionWithLists extends Section {
  lists: ArticleList[];
}

// Admin-editor shapes: article lists show their raw membership (with a
// resolved title label, but unfiltered by revealed/access - the DM manages
// everything regardless of current visibility) plus enough info to render
// add/remove/reorder controls.
export interface AdminArticleListItem {
  id: string;
  entityId: string;
  title: string;
  sortOrder: number;
}

export interface AdminArticleList {
  id: string;
  sectionId: string;
  entityType: SectionEntityType;
  templateId?: string | null;
  templateName?: string | null;
  name: string;
  sortOrder: number;
  items: AdminArticleListItem[];
}

// ---------------------------------------------------------------------------
// Phase 2 of the "Section Creator": DM-authored custom article Templates.
// Deliberately global (no campaign_id anywhere in this group) - see the
// design note on the `templates` table in schema.sql and
// project_erendyl_sections_phase2_templates memory: Aviv wants these
// reusable/shareable across campaigns (and eventually across users, once
// the codex is public-use), unlike every other piece of content here.
// ---------------------------------------------------------------------------

export type TemplateFieldType = "text" | "textarea" | "number" | "image" | "checkbox" | "heading" | "reference";

// Marks which field feeds the card/detail-page display for an article of
// this template. Exactly one field should carry "title" - enforced in
// adminUpsertTemplateField, not by the DB. "image" role is only meaningful
// on a field whose fieldType is itself "image".
export type TemplateFieldRole = "title" | "subtitle" | "description" | "image";

// ---------------------------------------------------------------------------
// Phase 3 of the "Section Creator": relationships. A field with
// fieldType === "reference" points at either a built-in entity type or
// another (global) template's articles - referenceTargetType picks which,
// mirroring how ArticleList.entityType already distinguishes built-ins from
// "custom" + templateId. referenceMultiple controls whether the field stores
// a single id or an array of ids in the article's data blob (see ArticleData
// below). Both referenceTargetType and referenceTemplateId are null/unused
// on every non-"reference" field. See article_references in schema.sql for
// how these get indexed for reverse lookup ("Referenced By").
// ---------------------------------------------------------------------------
export interface TemplateField {
  id: string;
  templateId: string;
  key: string;
  label: string;
  fieldType: TemplateFieldType;
  role: TemplateFieldRole | null;
  referenceTargetType?: SectionEntityType | null;
  referenceTemplateId?: string | null;
  referenceMultiple?: boolean;
  sortOrder: number;
}

export interface Template {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface TemplateWithFields extends Template {
  fields: TemplateField[];
}

// One article's field values, keyed by TemplateField.key. Values are
// strings for text/textarea/image(url), numbers for number fields, booleans
// for checkbox fields, a single id string for a single-valued "reference"
// field, or an array of id strings for a multi-valued "reference" field.
// "heading" fields never appear here - they're a pure display divider, not
// data.
export type ArticleData = Record<string, string | number | boolean | string[] | null>;

export interface Article {
  id: string;
  templateId: string;
  slug: string;
  revealed: boolean;
  data: ArticleData;
}

// ---------------------------------------------------------------------------
// Journals. Private, ownership-gated (see journal-queries.ts) - never part
// of the public revealed/entity_player_access model.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DM Screen (whiteboard). See src/lib/board-queries.ts. Admin-only, never
// part of the public revealed/entity_player_access model.
// ---------------------------------------------------------------------------

export type BoardItemType = "note" | "cheatsheet" | "link";

export interface BoardItem {
  id: string;
  type: BoardItemType;
  title: string | null;
  body: string | null;
  color: string | null;
  entityType: InheritableEntityType | null;
  entityId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

// Live-resolved display info for a 'link' item, fetched fresh on every board
// load so a renamed/edited article always shows current info rather than a
// stale snapshot taken when the link was first created.
export interface BoardLinkPreview {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  href: string;
}

export type JournalCategory = "event" | "contact";

export interface JournalEntry {
  id: string;
  ownerCharacterId: string;
  category: JournalCategory;
  subjectCharacterId: string | null;
  subjectName?: string | null;
  subjectSlug?: string | null;
  subjectPortraitPath?: string | null;
  title: string | null;
  body: string;
  trustValue: number | null;
  entryDate: string | null;
  createdAt: string;
  updatedAt: string;
}
