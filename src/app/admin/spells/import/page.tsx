import { redirect } from "next/navigation";
import { bulkImportSpells, type SpellInput } from "@/lib/library-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getMasterSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Same parse -> validate -> upsert-by-slug -> per-row-report pipeline as the
// creature importer (which was built as this template). Destination "library"
// = the shared platform armory (NULL campaign), master-gated server-side.

async function importAction(formData: FormData): Promise<{ created: number; updated: number; errors: { name: string; error: string }[] } | { parseError: string }> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const toLibrary = String(formData.get("destination") ?? "campaign") === "library";
  if (toLibrary) {
    const master = await getMasterSession();
    if (!master.isMaster) return { parseError: "Importing to the platform library requires an active master session - log in at /master first." };
  }
  const file = formData.get("file") as File | null;
  const pasted = String(formData.get("json") ?? "").trim();
  const text = file && file.size > 0 ? await file.text() : pasted;
  if (!text) return { parseError: "Paste JSON or choose a file first." };
  let rows: SpellInput[];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of spell objects.");
    rows = parsed;
  } catch (err) {
    return { parseError: err instanceof Error ? err.message : "Invalid JSON." };
  }
  return bulkImportSpells(toLibrary ? null : campaignId, rows);
}

export default async function AdminSpellsImportPage({
  searchParams,
}: {
  searchParams: { created?: string; updated?: string; errors?: string };
}) {
  async function handleSubmit(formData: FormData) {
    "use server";
    const result = await importAction(formData);
    if ("parseError" in result) {
      redirect(`/admin/spells/import?errors=${encodeURIComponent(JSON.stringify([{ name: "(file)", error: result.parseError }]))}`);
    }
    redirect(`/admin/spells/import?created=${result.created}&updated=${result.updated}&errors=${encodeURIComponent(JSON.stringify(result.errors))}`);
  }

  const created = searchParams.created ? Number(searchParams.created) : null;
  const updated = searchParams.updated ? Number(searchParams.updated) : null;
  let errors: { name: string; error: string }[] = [];
  if (searchParams.errors) {
    try { errors = JSON.parse(searchParams.errors); } catch { errors = []; }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-2">Bulk Import Spells</h1>
      <p className="text-sm text-parchment/40 mb-6">
        Paste a JSON array of spell objects, or upload a .json file. Each object needs at least a{" "}
        <code className="text-gold/70">name</code>; <code className="text-gold/70">level</code>,{" "}
        <code className="text-gold/70">school</code>, <code className="text-gold/70">source</code> and{" "}
        <code className="text-gold/70">details</code> (castingTime/range/components/duration/classes/description/
        higherLevel/ritual/concentration) are optional. Matching by name/slug means re-running an import updates
        existing spells instead of duplicating them.
      </p>

      {(created !== null || errors.length > 0) && (
        <div className="mb-6 rounded-lg border border-gold/20 bg-void/40 p-4 text-sm">
          {created !== null && (
            <p className="text-parchment"><span className="text-gold">{created}</span> created, <span className="text-gold">{updated}</span> updated.</p>
          )}
          {errors.length > 0 && (
            <div className="mt-2">
              <p className="text-blood/90 font-medium">{errors.length} error{errors.length === 1 ? "" : "s"}:</p>
              <ul className="mt-1 space-y-1 text-parchment/60 text-xs max-h-64 overflow-y-auto">
                {errors.map((e, i) => (
                  <li key={i}><span className="text-parchment/80">{e.name}</span>: {e.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <form action={handleSubmit} className="space-y-4 rounded-lg border border-gold/15 p-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Upload .json file</span>
          <input type="file" name="file" accept="application/json" className="block w-full text-sm text-parchment/70 file:mr-3 file:rounded-full file:border file:border-gold/40 file:bg-transparent file:px-3 file:py-1.5 file:text-gold file:text-xs" />
        </label>
        <p className="text-xs text-parchment/40 text-center">— or —</p>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Paste JSON</span>
          <textarea name="json" rows={10} placeholder='[{"name": "Fireball", "level": 3, "school": "Evocation", "details": {"castingTime": "1 action", "range": "150 feet"}}]' className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-xs font-mono focus:outline-none focus:border-gold/70" />
        </label>
        <fieldset className="space-y-1">
          <legend className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Import into</legend>
          <label className="flex items-center gap-2 text-sm text-parchment/80">
            <input type="radio" name="destination" value="campaign" defaultChecked className="accent-[#6e1f14]" />
            This campaign
          </label>
          <label className="flex items-center gap-2 text-sm text-parchment/80">
            <input type="radio" name="destination" value="library" className="accent-[#6e1f14]" />
            Platform library (shared with every DM - requires a master session)
          </label>
        </fieldset>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">Import</button>
      </form>
    </div>
  );
}
