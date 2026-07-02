import Link from "next/link";
import { redirect } from "next/navigation";
import {
  adminGetCampaigns,
  adminRenameCampaign,
  adminDeleteCampaign,
  getCurrentCampaignId,
  setCurrentCampaignId,
} from "@/lib/campaign-queries";
import { Field } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function renameAction(id: string, formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await adminRenameCampaign(id, name);
  redirect("/admin/campaigns");
}

async function deleteAction(id: string, formData: FormData) {
  "use server";
  const campaigns = await adminGetCampaigns();
  if (campaigns.length <= 1) return; // never delete the last remaining campaign
  await adminDeleteCampaign(id);
  const current = await getCurrentCampaignId();
  if (current === id) {
    const remaining = await adminGetCampaigns();
    if (remaining[0]) await setCurrentCampaignId(remaining[0].id);
  }
  redirect("/admin/campaigns");
}

export default async function CampaignsPage() {
  const campaigns = await adminGetCampaigns();
  const currentId = await getCurrentCampaignId();

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-gold">Campaigns</h1>
        <Link href="/admin/campaigns/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold">
          + New Campaign
        </Link>
      </div>
      <div className="space-y-3">
        {campaigns.map((c) => {
          const rename = renameAction.bind(null, c.id);
          const del = deleteAction.bind(null, c.id);
          return (
            <div key={c.id} className="rounded-lg border border-gold/15 p-4 flex items-center gap-4">
              {c.id === currentId && (
                <span className="text-xs text-gold border border-gold/40 rounded-full px-2 py-0.5 shrink-0">Active</span>
              )}
              <form action={rename} className="flex items-center gap-2 flex-1">
                <Field label="" name="name" defaultValue={c.name} className="flex-1" />
                <button type="submit" className="text-xs text-gold hover:underline shrink-0">Rename</button>
              </form>
              {campaigns.length > 1 && (
                <form action={del}>
                  <button type="submit" className="text-xs text-blood hover:underline shrink-0">Delete</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
