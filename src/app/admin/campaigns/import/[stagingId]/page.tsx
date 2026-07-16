import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { adminGetCampaigns, getCurrentCampaignId } from "@/lib/campaign-queries";
import { getStagedImport, commitCampaignImport, type CommitTarget, type CommitSelection } from "@/lib/campaign-io/import";
import { ENTITY_TYPES, type EntityTypeKey } from "@/lib/campaign-io/registry";
import { CampaignImportReviewForm } from "@/components/CampaignImportReviewForm";
import { getCurrentDmId } from "@/lib/dm-queries";
import { LEGACY_DM_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

// CLOSED BETA: founder-only, see the note in ../page.tsx.
export default async function CampaignImportReviewPage({ params }: { params: { stagingId: string } }) {
  if ((await getCurrentDmId()) !== LEGACY_DM_ID) redirect("/admin/campaigns");
  const { stagingId } = params;
  const staged = await getStagedImport(stagingId);
  if (!staged) notFound();

  const [campaigns, currentCampaignId] = await Promise.all([adminGetCampaigns(), getCurrentCampaignId()]);

  async function commitAction(formData: FormData) {
    "use server";
    if ((await getCurrentDmId()) !== LEGACY_DM_ID) redirect("/admin/campaigns");
    const mode = String(formData.get("mode") ?? "existing") as "existing" | "new";
    const target: CommitTarget =
      mode === "new"
        ? { mode: "new", newCampaignName: String(formData.get("newCampaignName") ?? "") }
        : { mode: "existing", campaignId: String(formData.get("campaignId") ?? "") };

    const types: Partial<Record<EntityTypeKey, string[]>> = {};
    for (const type of ENTITY_TYPES) {
      types[type] = formData.getAll(`sel_${type}`).map(String);
    }
    const selection: CommitSelection = { types };

    let report;
    try {
      report = await commitCampaignImport(stagingId, target, selection);
    } catch (err) {
      redirect(`/admin/campaigns/import/${stagingId}?error=${encodeURIComponent((err as Error).message)}`);
    }

    const payload = Buffer.from(JSON.stringify(report)).toString("base64url");
    redirect(`/admin/campaigns/import/result?r=${payload}`);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl text-gold">Review Import</h1>
        <Link href="/admin/campaigns" className="text-xs text-parchment/50 hover:text-gold">&larr; Campaigns</Link>
      </div>

      {staged.warnings.length > 0 && (
        <div className="rounded-lg border border-ember/40 bg-ember/5 p-4 mb-6">
          <span className="block text-xs uppercase tracking-widest text-ember mb-2">
            {staged.warnings.length} note{staged.warnings.length === 1 ? "" : "s"} from parsing this file
          </span>
          <ul className="text-xs text-parchment/60 space-y-1 max-h-40 overflow-y-auto list-disc list-inside">
            {staged.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <CampaignImportReviewForm
        preview={staged.preview}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        defaultCampaignId={currentCampaignId}
        commitAction={commitAction}
      />
    </div>
  );
}
