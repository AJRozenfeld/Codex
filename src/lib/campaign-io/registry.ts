// ---------------------------------------------------------------------------
// Campaign Export/Import - entity registry (Aviv's spec, 2026-07-05).
//
// Single source of truth for every entity type the campaign.md format knows
// how to read/write. The exporter (serialize.ts/export.ts), the parser
// (parse.ts), the importer (import.ts), and the admin UI's selection
// checkboxes all read from this one file - adding a new entity type later
// (say, a future "Prophecies") means adding one EntityTypeSchema entry here,
// not reworking any of those four modules. This is the extensibility Aviv
// asked for explicitly: "I want it to be fully functioning for v1... I don't
// want to have to rework basic code to fit it afterwards."
//
// v1 scope: the eight "core narrative" entity types, the same set already
// covered by the campaign inherit/copy-graph (see INHERITABLE_ENTITY_TYPES
// in types.ts) minus Maps. See the design note at the bottom of this file
// for what's deliberately deferred past v1, and why.
// ---------------------------------------------------------------------------

export type FieldKind =
  | "string" // single-line text -> plain YAML scalar
  | "text" // multi-line prose -> YAML block scalar (the `|` style)
  | "number"
  | "boolean"
  | "image" // export: path into the zip's images/ folder. import: replaced with an uploaded blob URL before commit.
  | "ref" // a single reference to another entity, written as that entity's identity value (its name/title)
  | "refList" // a list of references, written as a plain YAML list of identity values
  | "json"; // an opaque nested object/array (e.g. a full CharacterSheetData blob) - written as one inline JSON value, which is also valid YAML flow syntax, so js-yaml's load() parses it straight back into the same object with no custom coercion needed.

export interface FieldSchema {
  /** Property name on a collected/parsed record, and the YAML key in the MD file. */
  key: string;
  kind: FieldKind;
  /** Required fields are always emitted (even as "") so a hand-edited file always shows the full shape. */
  required?: boolean;
  /** Only meaningful for kind 'ref' | 'refList' - which entity type the reference resolves against. */
  refType?: EntityTypeKey;
}

export interface EntityTypeSchema {
  key: EntityTypeKey;
  /** The <Tag> wrapper name in the MD file, e.g. every character sits inside <Characters>...</Characters>. */
  tag: string;
  /** Display label for admin UI (export/import pickers). */
  label: string;
  /** Which field is this entity's heading (## <value>) and the string other entities reference it by. */
  identityField: string;
  fields: FieldSchema[];
}

export const ENTITY_TYPES = [
  "moons",
  "regions",
  "locations",
  "factions",
  "characters",
  "characterSheets",
  "storylines",
  "artifacts",
  "timelineEvents",
] as const;
export type EntityTypeKey = (typeof ENTITY_TYPES)[number];

// Dependency order for import commit: by the time a type is processed, every
// type it could reference (ref/refList refType) has already been committed,
// so name -> id resolution against "things also in this import batch" always
// has an answer available if one exists. locations is self-referential
// (parent) so it gets its own two-pass handling inside import.ts, same
// technique campaign-queries.ts's copyCampaignGraph already uses. A future
// entity type needs to be slotted in wherever its own reference fields
// require - see import.ts's resolveRef() for how a name found in NEITHER
// this batch NOR the target campaign is handled (left unresolved + reported
// as a warning, never a hard failure).
export const IMPORT_ORDER: EntityTypeKey[] = [
  "moons",
  "regions",
  "locations",
  "factions",
  "characters",
  "characterSheets",
  "artifacts",
  "storylines",
  "timelineEvents",
];

export const REGISTRY: Record<EntityTypeKey, EntityTypeSchema> = {
  moons: {
    key: "moons",
    tag: "Moons",
    label: "Moons",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "cycle", kind: "string" },
      { key: "domain", kind: "string", required: true },
      { key: "description", kind: "text", required: true },
      { key: "color", kind: "string" },
      { key: "isGoddess", kind: "boolean" },
      { key: "sortOrder", kind: "number" },
    ],
  },
  regions: {
    key: "regions",
    tag: "Regions",
    label: "Regions",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "type", kind: "string", required: true },
      { key: "capital", kind: "string" },
      { key: "government", kind: "string" },
      { key: "faith", kind: "string" },
      { key: "moon", kind: "ref", refType: "moons" },
      { key: "description", kind: "text", required: true },
      { key: "color", kind: "string" },
      { key: "sortOrder", kind: "number" },
      { key: "revealed", kind: "boolean" },
    ],
  },
  locations: {
    key: "locations",
    tag: "Locations",
    label: "Locations",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "type", kind: "string", required: true },
      { key: "parent", kind: "ref", refType: "locations" },
      { key: "region", kind: "ref", refType: "regions" },
      { key: "description", kind: "text", required: true },
      { key: "thumbnail", kind: "image" },
      { key: "revealed", kind: "boolean" },
      { key: "notes", kind: "text" },
    ],
  },
  factions: {
    key: "factions",
    tag: "Factions",
    label: "Factions",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "type", kind: "string", required: true },
      { key: "region", kind: "ref", refType: "regions" },
      { key: "description", kind: "text", required: true },
      { key: "goals", kind: "text" },
      { key: "notes", kind: "text" },
      { key: "revealed", kind: "boolean" },
    ],
  },
  characters: {
    key: "characters",
    tag: "Characters",
    label: "Characters",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "isPc", kind: "boolean" },
      { key: "isAlive", kind: "boolean" },
      { key: "race", kind: "string" },
      { key: "charClass", kind: "string" },
      { key: "status", kind: "string" },
      { key: "summary", kind: "text", required: true },
      { key: "bio", kind: "text", required: true },
      { key: "tags", kind: "string" },
      { key: "portrait", kind: "image" },
      { key: "revealed", kind: "boolean" },
      { key: "location", kind: "ref", refType: "locations" },
      { key: "factions", kind: "refList", refType: "factions" },
    ],
  },
  // A character's full 5e stat block (ability scores, skills, spells,
  // equipment, etc. - see CharacterSheetData in types.ts). Deliberately kept
  // as its own entity type with just two fields rather than flattening every
  // CharacterSheetData key into its own FieldSchema: the data is a nested
  // object (ability scores, per-skill proficiency flags, an attacks array,
  // a spells array) that doesn't fit this registry's flat-scalar field model
  // without a "json" escape hatch - see the FieldKind doc above. One sheet
  // per character (character_sheets.character_id is UNIQUE), so `character`
  // (the owning character's name) doubles as this type's identity field -
  // there's no separate name of its own.
  characterSheets: {
    key: "characterSheets",
    tag: "CharacterSheets",
    label: "Character Sheets",
    identityField: "character",
    fields: [
      { key: "character", kind: "ref", refType: "characters", required: true },
      { key: "data", kind: "json", required: true },
    ],
  },
  storylines: {
    key: "storylines",
    tag: "Storylines",
    label: "Storylines",
    identityField: "title",
    fields: [
      { key: "title", kind: "string", required: true },
      { key: "status", kind: "string", required: true },
      { key: "priority", kind: "string" },
      { key: "summary", kind: "text", required: true },
      { key: "description", kind: "text" },
      { key: "location", kind: "ref", refType: "locations" },
      { key: "nextStep", kind: "text" },
      { key: "revealed", kind: "boolean" },
      { key: "characters", kind: "refList", refType: "characters" },
    ],
  },
  artifacts: {
    key: "artifacts",
    tag: "Artifacts",
    label: "Artifacts",
    identityField: "name",
    fields: [
      { key: "name", kind: "string", required: true },
      { key: "type", kind: "string", required: true },
      { key: "rarity", kind: "string" },
      { key: "attunement", kind: "boolean" },
      { key: "owner", kind: "ref", refType: "characters" },
      { key: "location", kind: "ref", refType: "locations" },
      { key: "description", kind: "text", required: true },
      { key: "mechanics", kind: "text" },
      { key: "image", kind: "image" },
      { key: "revealed", kind: "boolean" },
    ],
  },
  timelineEvents: {
    key: "timelineEvents",
    tag: "TimelineEvents",
    label: "Timeline Events",
    identityField: "title",
    fields: [
      { key: "title", kind: "string", required: true },
      { key: "description", kind: "text", required: true },
      { key: "inWorldDate", kind: "string" },
      { key: "sortIndex", kind: "number", required: true },
      { key: "sessionNumber", kind: "number" },
      { key: "eventType", kind: "string", required: true },
      { key: "location", kind: "ref", refType: "locations" },
      { key: "storyline", kind: "ref", refType: "storylines" },
      { key: "revealed", kind: "boolean" },
      { key: "characters", kind: "refList", refType: "characters" },
    ],
  },
};

export function fieldsOf(type: EntityTypeKey): FieldSchema[] {
  return REGISTRY[type].fields;
}

export function typeByTag(tag: string): EntityTypeKey | null {
  for (const key of ENTITY_TYPES) {
    if (REGISTRY[key].tag === tag) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deliberately deferred past v1 (kept here so the reasoning survives):
//
// - Templates/Articles: DM-authored dynamic field schemas (Phase 2/3 of the
//   "Section Creator") don't fit this registry's fixed-field-list shape -
//   EntityTypeSchema.fields assumes a code-known list. A future v2 could add
//   a <Templates> block (declaring its field list inline) and an <Articles>
//   block (each article naming a template, values keyed to that template's
//   own field keys), but that's a genuinely different shape deserving its
//   own pass, not a forced fit here.
// - Maps (+pins, +character-token region overrides): map_pins reference
//   OTHER maps and map_regions reference locations - resolvable in principle,
//   but "which bundled image belongs to which map" needs its own manifest
//   handling alongside portraits/thumbnails, and pins/regions aren't
//   individually selectable today even in the existing inherit/copy-graph.
// - Journal entries, DM Board items: private DM/player prep, not really
//   "campaign content" to hand off - no technical blocker, just out of
//   scope for what Aviv described wanting (an NPC/location/lore handoff).
// - Player accounts + entity_player_access: sensitive (password hashes) and
//   explicitly out of scope per Aviv's "let's make it work first" - every
//   imported/exported entity defaults to visible-to-all-players, no
//   restriction transferred. Flagged in the import report, not silently
//   dropped.
// - character_factions.role / storyline_characters.role: the schema has a
//   `role` column on both join tables, but no admin UI currently sets it
//   (adminUpsertCharacter/adminUpsertStoryline always insert with role =
//   NULL) - so v1's `characters.factions` / `storylines.characters` /
//   `timelineEvents.characters` fields are plain refList (names only, no
//   role) rather than a richer refList-with-role shape. Revisit if/when the
//   admin UI grows the ability to set these roles.
// ---------------------------------------------------------------------------
