import Link from "next/link";
import { adminGetCampaign, setCurrentCampaignId } from "@/lib/campaign-queries";
import { REGISTRY, ENTITY_TYPES, type EntityTypeKey } from "@/lib/campaign-io/registry";
import type { CommitReport } from "@/lib/campaign-io/import";

export const dynamic = "force-dynamic";

async function switchToImportedCampaign(campaignId: string) {
  "use server";
  await setCurrentCampaignId(campaignId);
}

export default async function CampaignImportResultPage({ searchParams }: { searchParams: { r?: string } }) {
  if (!searchParams?.r) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-parchment/50">No import result to show.</p>
        <Link href="/admin/campaigns/import" className="text-gold hover:underline text-sm">Start a new import</Link>
      </div>
    );
  }

  let report: CommitReport;
  try {
    report = JSON.parse(Buffer.from(searchParams.r, "base64url").toString("utf-8"));
  } catch {
    return <div className="max-w-2xl"><p className="text-sm text-blood">Couldn&apos;t read this import result.</p></div>;
  }

  const campaign = await adminGetCampaign(report.campaignId);
  const switchAction = switchToImportedCampaign.bind(null, report.campaignId);
  const totalCreated = ENTITY_TYPES.reduce((sum, t) => sum + (report.created[t] ?? 0), 0);
  const totalUpdated = ENTITY_TYPES.reduce((sum, t) => sum + (report.updated[t] ?? 0), 0);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-2">Import Complete</h1>
      <p className="text-sm text-parchment/60 mb-6">
        Imported into <span className="text-gold">{campaign?.name ?? "(deleted campaign)"}</span> -{" "}
        {totalCreated} created, {totalUpdated} updated.
      </p>

      <div className="rounded-lg border border-gold/20 p-4 mb-6 space-y-1.5">
        {ENTITY_TYPES.map((type: EntityTypeKey) => {
          const c = report.created[type] ?? 0;
          const u = report.updated[type] ?? 0;
          if (c === 0 && u === 0) return null;
          return (
            <div key={type} className="flex justify-between text-sm text-parchment/70">
              <span>{REGISTRY[type].label}</span>
              <span>{c} created, {u} updated</span>
            </div>
          );
        })}
      </div>

      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-ember/40 bg-ember/5 p-4 mb-6">
          <span className="block text-xs uppercase tracking-widest text-ember mb-2">
            {report.warnings.length} note{report.warnings.length === 1 ? "" : "s"}
          </span>
          <ul className="text-xs text-parchment/60 space-y-1 max-h-56 overflow-y-auto list-disc list-inside">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-4">
        <form action={switchAction}>
          <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
            Switch to {campaign?.name ?? "this campaign"}
          </button>
        </form>
        <Link href="/admin/campaigns" className="text-sm text-parchment/50 hover:text-gold">Campaigns</Link>
      </div>
    </div>
  );
}
