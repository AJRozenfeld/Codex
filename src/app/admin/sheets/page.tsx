import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentDmId } from "@/lib/dm-queries";
import {
  listSheetTemplatesForDm,
  createSheetTemplate,
  deleteSheetTemplate,
  listCampaignSheetAssignments,
  setCampaignSheetTemplate,
} from "@/lib/sheet-template-queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Sheet Systems (Sheet Engine Phase B, 2026-08-06). The DM's custom sheet
// templates: create (as a full copy of 5e, or a minimal skeleton - Aviv's
// call: both), edit, delete (campaigns using one fall back to seeded 5e),
// and the per-campaign system picker. Switching a campaign's system never
// touches stored sheet data - fields the new system doesn't know simply
// stop rendering, and return on switching back (keep data, warn).
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm focus:outline-none focus:border-gold/70";
const labelCls = "block text-[10px] uppercase tracking-widest text-ember/80 mb-1";

function done(error?: string): never {
  redirect(error ? `/admin/sheets?error=${encodeURIComponent(error)}` : "/admin/sheets");
}

async function createAction(formData: FormData) {
  "use server";
  const dmId = await getCurrentDmId();
  const from = formData.get("from") === "minimal" ? "minimal" : "5e";
  const r = await createSheetTemplate(dmId, String(formData.get("name") ?? ""), from);
  if (!r.ok) done(r.error);
  redirect(`/admin/sheets/${r.id}`);
}

async function deleteAction(formData: FormData) {
  "use server";
  const dmId = await getCurrentDmId();
  const r = await deleteSheetTemplate(dmId, String(formData.get("templateId") ?? ""));
  done(
    r.deleted && r.freedCampaigns > 0
      ? `Deleted - ${r.freedCampaigns} campaign${r.freedCampaigns === 1 ? "" : "s"} returned to the standard 5e sheet.`
      : undefined
  );
}

async function assignAction(formData: FormData) {
  "use server";
  const dmId = await getCurrentDmId();
  const raw = String(formData.get("templateId") ?? "");
  const r = await setCampaignSheetTemplate(dmId, String(formData.get("campaignId") ?? ""), raw === "__5e" ? null : raw);
  done(r.ok ? undefined : r.error);
}

export default async function AdminSheetSystemsPage({ searchParams }: { searchParams: { error?: string } }) {
  const dmId = await getCurrentDmId();
  const [templates, assignments] = await Promise.all([listSheetTemplatesForDm(dmId), listCampaignSheetAssignments(dmId)]);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-2xl text-gold">Sheet Systems</h1>
        <p className="text-sm text-parchment/50 mt-1 max-w-2xl">
          The rules a character sheet lives by - abilities, skills, derived formulas, roll variables. Each campaign picks one
          system; the standard D&amp;D 5e sheet is always available and always the fallback. Custom systems power custom stats
          everywhere: the sheet itself, its d20 buttons, and Discord command rolls.
        </p>
      </div>

      {searchParams?.error && (
        <div className="rounded-lg border border-blood/50 bg-void p-3 text-sm text-blood">{searchParams.error}</div>
      )}

      {/* ---------- Create ---------- */}
      <form action={createAction} className="rounded-lg border border-gold/20 bg-void p-4 grid sm:grid-cols-[1fr_14rem_auto] gap-3 items-end">
        <label className="block">
          <span className={labelCls}>New system name</span>
          <input className={inputCls} name="name" placeholder="e.g. Grim Tides" required />
        </label>
        <label className="block">
          <span className={labelCls}>Start from</span>
          <select className={inputCls} name="from" defaultValue="5e">
            <option value="5e">A full copy of the 5e sheet</option>
            <option value="minimal">A minimal skeleton</option>
          </select>
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold whitespace-nowrap">
          + Create System
        </button>
      </form>

      {/* ---------- Systems table ---------- */}
      <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
            <tr>
              <th className="px-4 py-2">System</th>
              <th className="px-4 py-2">Shape</th>
              <th className="px-4 py-2">Used by</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gold/10">
              <td className="px-4 py-2 text-parchment">
                D&amp;D 5e (2014) <span className="ml-2 text-[10px] uppercase tracking-widest text-gold/60 border border-gold/25 rounded-full px-2 py-0.5">seeded</span>
              </td>
              <td className="px-4 py-2 text-parchment/70">6 abilities · 18 skills</td>
              <td className="px-4 py-2 text-parchment/70">
                {assignments.filter((a) => !a.sheetTemplateId).map((a) => a.campaignName).join(", ") || "—"}
              </td>
              <td className="px-4 py-2 text-right text-xs text-parchment/40">built-in, always available</td>
            </tr>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                <td className="px-4 py-2 text-parchment">
                  {t.name}
                  {!t.healthy && (
                    <span className="ml-2 text-[10px] uppercase tracking-widest text-blood border border-blood/40 rounded-full px-2 py-0.5" title="The stored definition doesn't parse - campaigns using it render the 5e fallback. Open to rebuild.">
                      broken
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-parchment/70">{t.shape}</td>
                <td className="px-4 py-2 text-parchment/70">{t.usedBy.join(", ") || "—"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <Link href={`/admin/sheets/${t.id}`} className="text-gold hover:underline mr-4">Edit</Link>
                  <form action={deleteAction} className="inline">
                    <input type="hidden" name="templateId" value={t.id} />
                    <button
                      type="submit"
                      className="text-blood text-xs hover:underline"
                      title={t.usedBy.length > 0 ? `${t.usedBy.length} campaign(s) will return to the standard 5e sheet` : "Delete this system"}
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-parchment/40">No custom systems yet - every campaign runs the standard 5e sheet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- Campaign assignment ---------- */}
      <section className="rounded-lg border border-gold/20 bg-void p-4">
        <h2 className="font-display text-lg text-gold mb-1">Which system does each campaign use?</h2>
        <p className="text-xs text-parchment/40 mb-4 max-w-2xl">
          Switching never deletes anything: existing sheets keep all their stored values, fields the new system doesn&apos;t know are
          simply hidden until you switch back. Players see the new sheet immediately.
        </p>
        <div className="space-y-2">
          {assignments.map((a) => (
            <form key={a.campaignId} action={assignAction} className="flex items-center gap-3 flex-wrap">
              <input type="hidden" name="campaignId" value={a.campaignId} />
              <span className="w-56 text-sm text-parchment/80 truncate">{a.campaignName}</span>
              <select className={`${inputCls} max-w-64`} name="templateId" defaultValue={a.sheetTemplateId ?? "__5e"}>
                <option value="__5e">D&amp;D 5e (2014) — standard</option>
                {templates.filter((t) => t.healthy).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button type="submit" className="text-xs rounded-full border border-gold/40 text-gold px-3 py-1.5 hover:bg-gold/10">
                Apply
              </button>
              {a.sheetCount > 0 && (
                <span className="text-[11px] text-parchment/40">
                  {a.sheetCount} existing sheet{a.sheetCount === 1 ? "" : "s"} - data is kept through any switch
                </span>
              )}
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
