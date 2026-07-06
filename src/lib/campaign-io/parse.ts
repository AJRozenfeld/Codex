import { load } from "js-yaml";
import { REGISTRY, ENTITY_TYPES, typeByTag, type EntityTypeKey, type FieldKind } from "./registry";
import type { FieldValue } from "./collect";

// ---------------------------------------------------------------------------
// Parses a campaign.md file's text back into typed records, the inverse of
// serialize.ts. Only the "which lines belong to which entity" splitting is
// hand-rolled - each entity's actual field block is handed to js-yaml's
// load(), so quoting/escaping edge cases are handled by a real YAML parser
// rather than a hand-rolled one. Unknown tags or fields are ignored rather
// than treated as errors (forward/backward compatible with a registry that
// gains fields over time), but every skip is recorded in `warnings` so the
// import staging preview can surface it to the DM instead of silently
// dropping content.
// ---------------------------------------------------------------------------

export interface RawEntity {
  /** The ## heading text as written in the file - used as a fallback identity if the identity field itself is missing/blank. */
  heading: string;
  identity: string;
  record: Record<string, FieldValue>;
}

export interface ParsedCampaign {
  entities: Record<EntityTypeKey, RawEntity[]>;
  warnings: string[];
}

function coerceField(raw: unknown, kind: FieldKind): FieldValue {
  if (kind === "refList") {
    if (Array.isArray(raw)) return raw.map((v) => String(v));
    if (raw == null || raw === "") return [];
    return [String(raw)];
  }
  if (kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return /^(true|yes|1)$/i.test(raw.trim());
    return !!raw;
  }
  if (kind === "number") {
    if (typeof raw === "number") return raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (kind === "json") {
    // js-yaml's load() already parsed the inline JSON into a real
    // object/array (or a hand-editor could have written genuine multi-line
    // YAML for the same value - either way it comes through load() as a
    // plain JS value) - pass it through as-is rather than stringifying it.
    return (raw ?? null) as FieldValue;
  }
  // string, text, image, ref
  if (raw == null) return null;
  return String(raw);
}

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function parseCampaignMd(mdText: string): ParsedCampaign {
  const warnings: string[] = [];
  const entities = {} as Record<EntityTypeKey, RawEntity[]>;
  for (const type of ENTITY_TYPES) entities[type] = [];

  const cleaned = stripComments(mdText);
  const tagRe = /<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g;
  let tagMatch: RegExpExecArray | null;
  let foundAnyTag = false;

  while ((tagMatch = tagRe.exec(cleaned)) !== null) {
    foundAnyTag = true;
    const [, tag, inner] = tagMatch;
    const type = typeByTag(tag);
    if (!type) {
      warnings.push(`Unknown entity type tag <${tag}> - skipped (not in this Codex's registry).`);
      continue;
    }
    const schema = REGISTRY[type];

    // Split the block on lines starting with "## " - each chunk from one
    // heading up to (but not including) the next is one entity.
    const headingRe = /^##\s+(.*)$/gm;
    const headings: { index: number; text: string }[] = [];
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRe.exec(inner)) !== null) {
      headings.push({ index: hMatch.index, text: hMatch[1].trim() });
    }

    for (let i = 0; i < headings.length; i++) {
      const start = inner.indexOf("\n", headings[i].index);
      const end = i + 1 < headings.length ? headings[i + 1].index : inner.length;
      const body = start === -1 ? "" : inner.slice(start + 1, end);

      let parsedYaml: unknown;
      try {
        parsedYaml = load(body);
      } catch (err) {
        warnings.push(
          `<${tag}> "${headings[i].text}" - couldn't parse its field block (${(err as Error).message}). Skipped.`
        );
        continue;
      }
      if (parsedYaml == null || typeof parsedYaml !== "object" || Array.isArray(parsedYaml)) {
        warnings.push(`<${tag}> "${headings[i].text}" - field block wasn't a set of key: value fields. Skipped.`);
        continue;
      }

      const raw = parsedYaml as Record<string, unknown>;
      const record: Record<string, FieldValue> = {};
      for (const field of schema.fields) {
        if (!(field.key in raw)) continue;
        record[field.key] = coerceField(raw[field.key], field.kind);
      }
      for (const key of Object.keys(raw)) {
        if (!schema.fields.some((f) => f.key === key)) {
          warnings.push(`<${tag}> "${headings[i].text}" - unknown field "${key}" ignored.`);
        }
      }

      const identityRaw = record[schema.identityField];
      const identity = (typeof identityRaw === "string" && identityRaw.trim()) || headings[i].text;
      if (!identity) {
        warnings.push(`<${tag}> entity with a blank ${schema.identityField} and heading - skipped, nothing to key it by.`);
        continue;
      }
      entities[type].push({ heading: headings[i].text, identity, record });
    }
  }

  if (!foundAnyTag) {
    warnings.push("No recognized <Tag>...</Tag> entity blocks found in this file - is this a Codex campaign export?");
  }

  return { entities, warnings };
}
