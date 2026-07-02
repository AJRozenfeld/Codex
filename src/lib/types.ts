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
