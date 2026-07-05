import Link from "next/link";
import { adminGetCampaigns, getCurrentCampaignId } from "@/lib/campaign-queries";
import { listPickerOptions } from "@/lib/campaign-io/collect";
import { CampaignExportForm } from "@/components/CampaignExportForm";
import type { EntityTypeKey } from "@/lib/campaign-io/registry";
import type { EntityOption } from "@/lib/campaign-io/collect";

export const dynamic = "force-dynamic";

export default async function CampaignExportPage() {
  const [campaigns, currentCampaignId] = await Promise.all([adminGetCampaigns(), getCurrentCampaignId()]);

  const optionsByCampaign: Record<string, Record<EntityTypeKey, EntityOption[]>> = {};
  await Promise.all(
    campaigns.map(async (c) => {
      optionsByCampaign[c.id] = await listPickerOptions(c.id);
    })
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl text-gold">Export Campaign</h1>
        <Link href="/admin/campaigns" className="text-xs text-parchment/50 hover:text-gold">&larr; Campaigns</Link>
      </div>
      <p className="text-sm text-parchment/50 mb-6">
        Bundle any part of a campaign into a hand-editable .zip - a campaign.md file plus its
        images. Re-import it later (into this campaign or a new one) from{" "}
        <Link href="/admin/campaigns/import" className="text-gold hover:underline">Import Campaign</Link>.
      </p>
      <CampaignExportForm
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        optionsByCampaign={optionsByCampaign}
        defaultCampaignId={currentCampaignId}
      />
    </div>
  );
}
