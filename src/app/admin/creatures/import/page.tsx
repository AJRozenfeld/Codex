import { redirect } from "next/navigation";
import { bulkImportCreatures, type CreatureImportRow } from "@/lib/creature-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Bulk import (2026-07-12). Paste or upload a JSON array of creature rows
// (name + optional hp/ac/initBonus/notes/portraitPath/source/statBlock) and
// upsert them all by slug in one go - built to seed the SRD monster list,
// but this exact page/action shape (parse -> validate row-by-row -> upsert
// -> per-row result report) is the template for the equipment/spell
// importers Aviv wants once those entity types exist.
// ---------------------------------------------------------------------------

async function importAction(formData: FormData): Promise<{ created: number; updated: number; errors: { name: string; error: string }[] } | { parseError: string }> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const file = formData.get("file") as File | null;
  const pasted = String(formData.get("json") ?? "").trim();
  const text = file && file.size > 0 ? await file.text() : pasted;
  if (!text) return { parseError: "Paste JSON or choose a file first." };
  let rows: CreatureImportRow[];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of creature objects.");
    rows = parsed;
  } catch (err) {
    return { parseError: err instanceof Error ? err.message : "Invalid JSON." };
  }
  return bulkImportCreatures(campaignId, rows);
}

export default async function AdminCreaturesImportPage({
  searchParams,
}: {
  searchParams: { created?: string; updated?: string; errors?: string };
}) {
  async function handleSubmit(formData: FormData) {
    "use server";
    const result = await importAction(formData);
    if ("parseError" in result) {
      redirect(`/admin/creatures/import?errors=${encodeURIComponent(JSON.stringify([{ name: "(file)", error: result.parseError }]))}`);
    }
    redirect(
      `/admin/creatures/import?created=${result.created}&updated=${result.updated}&errors=${encodeURIComponent(JSON.stringify(result.errors))}`
    );
  }

  const created = searchParams.created ? Number(searchParams.created) : null;
  const updated = searchParams.updated ? Number(searchParams.updated) : null;
  let errors: { name: string; error: string }[] = [];
  if (searchParams.errors) {
    try {
      errors = JSON.parse(searchParams.errors);
    } catch {
      errors = [];
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-2">Bulk Import Creatures</h1>
      <p className="text-sm text-parchment/40 mb-6">
        Paste a JSON array of creature objects, or upload a .json file. Each object needs at least a <code className="text-gold/70">name</code>;
        everything else (<code className="text-gold/70">hp</code>, <code className="text-gold/70">ac</code>,{" "}
        <code className="text-gold/70">initBonus</code>, <code className="text-gold/70">notes</code>,{" "}
        <code className="text-gold/70">portraitPath</code>, <code className="text-gold/70">source</code>,{" "}
        <code className="text-gold/70">statBlock</code>) is optional and merges with defaults. Matching by name/slug means
        re-running an import updates existing creatures instead of duplicating them.
      </p>

      {(created !== null || errors.length > 0) && (
        <div className="mb-6 rounded-lg border border-gold/20 bg-void/40 p-4 text-sm">
          {created !== null && (
            <p className="text-parchment">
              <span className="text-gold">{created}</span> created, <span className="text-gold">{updated}</span> updated.
            </p>
          )}
          {errors.length > 0 && (
            <div className="mt-2">
              <p className="text-blood/90 font-medium">{errors.length} error{errors.length === 1 ? "" : "s"}:</p>
              <ul className="mt-1 space-y-1 text-parchment/60 text-xs max-h-64 overflow-y-auto">
                {errors.map((e, i) => (
                  <li key={i}>
                    <span className="text-parchment/80">{e.name}</span>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <form action={handleSubmit} className="space-y-4 rounded-lg border border-gold/15 p-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Upload .json file</span>
          <input
            type="file"
            name="file"
            accept="application/json"
            className="block w-full text-sm text-parchment/70 file:mr-3 file:rounded-full file:border file:border-gold/40 file:bg-transparent file:px-3 file:py-1.5 file:text-gold file:text-xs"
          />
        </label>
        <p className="text-xs text-parchment/40 text-center">— or —</p>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Paste JSON</span>
          <textarea
            name="json"
            rows={10}
            placeholder='[{"name": "Goblin", "hp": 7, "ac": 15, "initBonus": 2, "source": "SRD 5.1 (CC BY 4.0)", "statBlock": {...}}]'
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-xs font-mono focus:outline-none focus:border-gold/70"
          />
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          Import
        </button>
      </form>
    </div>
  );
}
