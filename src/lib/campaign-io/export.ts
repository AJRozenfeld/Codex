import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { slugify } from "@/lib/slug";
import { REGISTRY, ENTITY_TYPES, type EntityTypeKey } from "./registry";
import { collectAll, type CollectedEntity } from "./collect";
import { serializeCampaign } from "./serialize";

// ---------------------------------------------------------------------------
// Builds the zip Aviv downloads from /admin/campaigns/export: a single
// campaign.md plus an /images folder. Fetching image bytes (from Vercel Blob
// in production, or public/uploads locally) is deliberately isolated to this
// one module - collect.ts only reads the database, serialize.ts only
// produces text, and this is the one place that also touches the network/
// filesystem for image bytes, mirroring how blob-storage.ts is the one place
// that WRITES image bytes on the import side.
// ---------------------------------------------------------------------------

async function fetchImageBytes(source: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  if (source.startsWith("/")) {
    const filePath = path.join(process.cwd(), "public", source);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }
  return null;
}

function extOf(source: string): string {
  const match = source.match(/\.(\w{2,5})(?:\?.*)?$/);
  return match ? match[1].toLowerCase() : "png";
}

export interface ExportSelection {
  /** Per-type array of entity ids to include. A type absent from this object means "include every row of that type". */
  types?: Partial<Record<EntityTypeKey, string[]>>;
}

export interface ExportResult {
  buffer: Buffer;
  /** Count of entities actually written per type, for a confirmation summary in the admin UI. */
  counts: Record<EntityTypeKey, number>;
  /** Images that couldn't be fetched (missing file, dead blob URL, etc.) - the export still succeeds, just without that one image. */
  imageWarnings: string[];
}

export async function buildCampaignExportZip(campaignId: string, selection?: ExportSelection): Promise<ExportResult> {
  const collected = await collectAll(campaignId, selection?.types);
  const zip = new JSZip();
  const imageWarnings: string[] = [];

  for (const type of ENTITY_TYPES) {
    const schema = REGISTRY[type];
    const imageFields = schema.fields.filter((f) => f.kind === "image");
    if (imageFields.length === 0) continue;

    for (const entity of collected[type] as CollectedEntity[]) {
      for (const field of imageFields) {
        const source = entity.record[field.key];
        if (typeof source !== "string" || !source) continue;
        const bytes = await fetchImageBytes(source);
        if (!bytes) {
          imageWarnings.push(`${schema.label} "${entity.identity}": couldn't fetch its ${field.key} image (${source}) - omitted from the export.`);
          entity.record[field.key] = null;
          continue;
        }
        const zipPath = `images/${type}/${slugify(entity.identity) || entity.id.slice(0, 8)}-${entity.id.slice(0, 8)}.${extOf(source)}`;
        zip.file(zipPath, bytes);
        entity.record[field.key] = zipPath;
      }
    }
  }

  const md = serializeCampaign(collected);
  zip.file("campaign.md", md);

  const counts = {} as Record<EntityTypeKey, number>;
  for (const type of ENTITY_TYPES) counts[type] = collected[type].length;

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer, counts, imageWarnings };
}
