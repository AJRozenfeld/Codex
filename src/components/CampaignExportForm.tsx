"use client";

import { useState } from "react";
import { ENTITY_TYPES, REGISTRY, type EntityTypeKey } from "@/lib/campaign-io/registry";
import type { EntityOption } from "@/lib/campaign-io/collect";

// ---------------------------------------------------------------------------
// Mirrors NewCampaignForm.tsx's per-type/per-item checkbox picker almost
// exactly (same interaction pattern Aviv already knows from "inherit from
// campaign"), just defaulted to everything CHECKED rather than everything
// unchecked - exporting "all of it" is the common case, per Aviv's spec
// ("you can export all of it, or just parts of it, by your choice").
// Submits as a plain HTML form POST (not a Next.js server action) straight
// to /admin/campaigns/export/download, since that route needs to return a
// raw zip file response, not a server-action result.
// ---------------------------------------------------------------------------

export function CampaignExportForm({
  campaigns,
  optionsByCampaign,
  defaultCampaignId,
}: {
  campaigns: { id: string; name: string }[];
  optionsByCampaign: Record<string, Record<EntityTypeKey, EntityOption[]>>;
  defaultCampaignId: string;
}) {
  const [campaignId, setCampaignId] = useState(defaultCampaignId);
  const options = optionsByCampaign[campaignId] ?? ({} as Record<EntityTypeKey, EntityOption[]>);

  const allIdsByType = (): Partial<Record<EntityTypeKey, Set<string>>> => {
    const map: Partial<Record<EntityTypeKey, Set<string>>> = {};
    for (const type of ENTITY_TYPES) map[type] = new Set((options[type] ?? []).map((o) => o.id));
    return map;
  };

  const [selected, setSelected] = useState<Partial<Record<EntityTypeKey, Set<string>>>>(() => allIdsByType());

  function handleCampaignChange(id: string) {
    setCampaignId(id);
    const opts = optionsByCampaign[id] ?? ({} as Record<EntityTypeKey, EntityOption[]>);
    const map: Partial<Record<EntityTypeKey, Set<string>>> = {};
    for (const type of ENTITY_TYPES) map[type] = new Set((opts[type] ?? []).map((o) => o.id));
    setSelected(map);
  }

  function toggleOne(type: EntityTypeKey, id: string) {
    setSelected((prev) => {
      const next = new Set(prev[type] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [type]: next };
    });
  }

  function toggleAll(type: EntityTypeKey, ids: string[], checked: boolean) {
    setSelected((prev) => ({ ...prev, [type]: checked ? new Set(ids) : new Set<string>() }));
  }

  return (
    <form action="/admin/campaigns/export/download" method="POST" className="space-y-4">
      <label className="block">
        <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Export which campaign</span>
        <select
          name="campaignId"
          value={campaignId}
          onChange={(e) => handleCampaignChange(e.target.value)}
          className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <p className="text-xs text-parchment/40">
        Everything is checked by default - uncheck anything you don&apos;t want in this export. The
        download is a .zip with a campaign.md file plus an images folder, ready to hand-edit or
        re-import later.
      </p>

      <div className="space-y-4">
        {ENTITY_TYPES.map((type) => {
          const typeOptions = options[type] ?? [];
          if (typeOptions.length === 0) return null;
          const selectedSet = selected[type] ?? new Set<string>();
          const allChecked = typeOptions.every((o) => selectedSet.has(o.id));
          return (
            <fieldset key={type} className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="block text-xs uppercase tracking-widest text-ember/80">
                  {REGISTRY[type].label} ({selectedSet.size}/{typeOptions.length})
                </span>
                <button
                  type="button"
                  onClick={() => toggleAll(type, typeOptions.map((o) => o.id), !allChecked)}
                  className="text-xs text-gold hover:underline"
                >
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-3 max-h-48 overflow-y-auto rounded-lg border border-gold/20 p-3">
                {typeOptions.map((o) => (
                  <label key={o.id} className="flex items-center gap-1.5 text-xs text-parchment/70">
                    <input
                      type="checkbox"
                      name={`sel_${type}`}
                      value={o.id}
                      checked={selectedSet.has(o.id)}
                      onChange={() => toggleOne(type, o.id)}
                      className="accent-gold"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="pt-4">
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          Download Export
        </button>
      </div>
    </form>
  );
}
