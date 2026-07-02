"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/lib/types";

export function CampaignSwitcher({
  campaigns,
  currentCampaignId,
  switchAction,
}: {
  campaigns: Campaign[];
  currentCampaignId: string;
  switchAction: (campaignId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={currentCampaignId}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(async () => {
          await switchAction(id);
          router.refresh();
        });
      }}
      className="rounded-full bg-void border border-gold/30 px-3 py-1.5 text-xs text-gold focus:outline-none focus:border-gold"
      title="Currently active campaign"
    >
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
