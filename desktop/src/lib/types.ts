// ---------------------------------------------------------------------------
// Shapes of what /api/v1 returns - mirrors the website's src/lib/types.ts
// (rowTo* mappers in queries.ts and the character-sheet types). The server is
// the source of truth: it always sends fully-merged, revealed-only data.
// ---------------------------------------------------------------------------

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
  moonName: string | null;
  description: string;
  color: string | null;
  sortOrder: number;
}

export interface Location {
  id: string;
  slug: string;
  name: string;
  type: string;
  parentId: string | null;
  parentName: string | null;
  parentSlug: string | null;
  regionId: string | null;
  regionName: string | null;
  regionSlug: string | null;
  description: string;
  thumbnailPath: string | null;
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
  locationId: string | null;
  locationName: string | null;
  locationSlug: string | null;
  mask: string | null;
}

export interface Faction {
  id: string;
  slug: string;
  name: string;
  type: string;
  regionId: string | null;
  regionName: string | null;
  regionSlug: string | null;
  description: string;
  goals: string | null;
  notes: string | null;
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
  locationName: string | null;
  locationSlug: string | null;
  nextStep: string | null;
}

export interface Artifact {
  id: string;
  slug: string;
  name: string;
  type: string;
  rarity: string | null;
  attunement: boolean;
  ownerCharacterId: string | null;
  ownerName: string | null;
  ownerSlug: string | null;
  locationId: string | null;
  locationName: string | null;
  locationSlug: string | null;
  description: string;
  mechanics: string | null;
  imagePath: string | null;
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
  locationName: string | null;
  locationSlug: string | null;
  storylineId: string | null;
}

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
  entityType: string;
  templateId?: string | null;
  name: string;
  sortOrder: number;
  items: ArticleListItemSummary[];
}

export interface Section {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  lists: ArticleList[];
}

export interface ContentSnapshot {
  moons: Moon[];
  regions: Region[];
  locations: Location[];
  characters: Character[];
  factions: Faction[];
  storylines: Storyline[];
  artifacts: Artifact[];
  timeline: TimelineEvent[];
  sections: Section[];
}

export interface CampaignInfo {
  id: string;
  name: string | null;
  showMoons: boolean;
}

export interface PlayerInfo {
  id: string;
  username: string;
  displayName: string | null;
}

export interface CharacterRef {
  id: string;
  name: string | null;
  slug: string | null;
  portraitPath: string | null;
}

// --------------------------- character sheet -------------------------------

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

export type RollPart = number | string;

export interface ActionRoll {
  id: string;
  label: string;
  count: RollPart;
  die: RollPart;
  modifiers: RollPart[];
}

export interface AttackEntry {
  id: string;
  name: string;
  description: string;
  rolls: ActionRoll[];
}

export interface CustomAction {
  id: string;
  name: string;
  description: string;
  rolls: ActionRoll[];
}

export interface SpellEntry {
  id: string;
  level: number;
  name: string;
  prepared: boolean;
  description: string;
  rolls: ActionRoll[];
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
  customActions: CustomAction[];
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

export interface LiveSheetState {
  hitPointCurrent: number;
  hitPointTemp: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  spellSlots: Record<string, SpellSlotLevel>;
}

export type LiveSheetPatch =
  | { kind: "hp"; current?: number; temp?: number }
  | { kind: "deathSaves"; successes?: number; failures?: number }
  | { kind: "slot"; level: string; used: number }
  | { kind: "longRest" };
