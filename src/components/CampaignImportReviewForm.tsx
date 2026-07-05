"use client";

import { useState } from "react";
import { ENTITY_TYPES, REGISTRY, type EntityTypeKey } from "@/lib/campaign-io/registry";
import type { StagePreviewType } from "@/lib/campaign-io/import";

// ---------------------------------------------------------------------------
// Review step between "zip uploaded & parsed" and "actually written to a
// campaign". Selection here is by identity (name/title) rather than id,
// since staged entities don't have database ids yet - matching how
// CommitSelection.types is keyed in import.ts. Same select-all-by-default,
// per-type checkbox pattern as the export form, plus the target campaign
// choice (merge into an existing campaign, or spin up a new one) Aviv asked
// for explicitly.
// ---------------------------------------------------------------------------

export function CampaignImportReviewForm({
  preview,
  campaigns,
  defaultCampaignId,
  commitAction,
}: {
  preview: Record<EntityTypeKey, StagePreviewType>;
  campaigns: { id: string; name: string }[];
  defaultCampaignId: string;
  commitAction: (formData: FormData) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selected, setSelected] = useState<Partial<Record<EntityTypeKey, Set<string>>>>(() => {
    const map: Partial<Record<EntityTypeKey, Set<string>>> = {};
    for (const type of ENTITY_TYPES) map[type] = new Set(preview[type]?.identities ?? []);
    return map;
  });

  function toggleOne(type: EntityTypeKey, identity: string) {
    setSelected((prev) => {
      const next = new Set(prev[type] ?? []);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return { ...prev, [type]: next };
    });
  }

  function toggleAll(type: EntityTypeKey, identities: string[], checked: boolean) {
    setSelected((prev) => ({ ...prev, [type]: checked ? new Set(identities) : new Set<string>() }));
  }

  return (
    <form action={commitAction} className="space-y-6">
      <div className="rounded-lg border border-gold/20 p-4 space-y-3">
        <span className="block text-xs uppercase tracking-widest text-ember/80">Import into</span>
        <label className="flex items-center gap-2 text-sm text-parchment/80">
          <input type="radio" name="mode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-gold" />
          An existing campaign (merge by matching name)
        </label>
        {mode === "existing" && (
          <select
            name="campaignId"
            defaultValue={defaultCampaignId}
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-parchment/80">
          <input type="radio" name="mode" value="new" checked={mode === "new"} onChange={() => setMode("new")} className="accent-gold" />
          A brand new campaign
        </label>
        {mode === "new" && (
          <input
            type="text"
            name="newCampaignName"
            placeholder="New campaign name"
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        )}
        <p className="text-xs text-parchment/40">
          Matching is by name (or title for storylines/timeline events) - an item whose name already
          exists in the target campaign gets updated in place; anything new is created. Imported
          content is visible to every player by default (per-player restrictions aren&apos;t part of
          this format yet).
        </p>
      </div>

      <div className="space-y-4">
        {ENTITY_TYPES.map((type) => {
          const typePreview = preview[type];
          if (!typePreview || typePreview.count === 0) return null;
          const selectedSet = selected[type] ?? new Set<string>();
          const allChecked = typePreview.identities.every((id) => selectedSet.has(id));
          return (
            <fieldset key={type} className="block">
              <div className="flex items-center justify-between mb-2">
                <span className="block text-xs uppercase tracking-widest text-ember/80">
                  {REGISTRY[type].label} ({selectedSet.size}/{typePreview.count})
                </span>
                <button
                  type="button"
                  onClick={() => toggleAll(type, typePreview.identities, !allChecked)}
                  className="text-xs text-gold hover:underline"
                >
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-3 max-h-48 overflow-y-auto rounded-lg border border-gold/20 p-3">
                {typePreview.identities.map((identity, i) => (
                  <label key={`${identity}-${i}`} className="flex items-center gap-1.5 text-xs text-parchment/70">
                    <input
                      type="checkbox"
                      name={`sel_${type}`}
                      value={identity}
                      checked={selectedSet.has(identity)}
                      onChange={() => toggleOne(type, identity)}
                      className="accent-gold"
                    />
                    {identity}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="pt-2">
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          Commit Import
        </button>
      </div>
    </form>
  );
}
