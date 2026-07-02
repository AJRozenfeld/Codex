"use client";

import { useState } from "react";
import { Field, FormActions } from "@/components/AdminForm";
import { INHERITABLE_ENTITY_TYPES, type InheritableEntityType } from "@/lib/types";

export interface EntityOption {
  id: string;
  label: string;
}

const TYPE_LABELS: Record<InheritableEntityType, string> = {
  moons: "Moons",
  regions: "Regions",
  locations: "Locations",
  factions: "Factions",
  characters: "Characters",
  storylines: "Storylines",
  artifacts: "Artifacts",
  timeline_events: "Timeline Events",
  maps: "Maps (+ pins)",
};

export function NewCampaignForm({
  campaigns,
  entitiesByCampaign,
  createAction,
}: {
  campaigns: { id: string; name: string }[];
  entitiesByCampaign: Record<string, Partial<Record<InheritableEntityType, EntityOption[]>>>;
  createAction: (formData: FormData) => void;
}) {
  const [inheritFrom, setInheritFrom] = useState("");
  const [selected, setSelected] = useState<Partial<Record<InheritableEntityType, Set<string>>>>({});

  const entities = inheritFrom ? entitiesByCampaign[inheritFrom] ?? {} : {};

  function handleInheritFromChange(value: string) {
    setInheritFrom(value);
    setSelected({}); // switching source campaigns clears previous picks
  }

  function toggleOne(type: InheritableEntityType, id: string) {
    setSelected((prev) => {
      const next = new Set(prev[type] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [type]: next };
    });
  }

  function toggleAll(type: InheritableEntityType, ids: string[], checked: boolean) {
    setSelected((prev) => ({ ...prev, [type]: checked ? new Set(ids) : new Set<string>() }));
  }

  return (
    <form action={createAction} className="space-y-4">
      <Field label="Campaign Name" name="name" required />

      <label className="block">
        <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">
          Inherit content from an existing campaign (optional)
        </span>
        <select
          name="inheritFrom"
          value={inheritFrom}
          onChange={(e) => handleInheritFromChange(e.target.value)}
          className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
        >
          <option value="">&mdash; Start empty &mdash;</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {inheritFrom && (
        <div className="space-y-4">
          <p className="text-xs text-parchment/40">
            Pick exactly what to bring over - nothing is copied by type alone. Everything copied
            starts hidden, with a blank journal/sheet for characters. If a copied item referred to
            something you didn&apos;t also check (e.g. a character in a location you left
            unchecked), that link is simply left blank rather than pointing back at the old
            campaign.
          </p>
          {INHERITABLE_ENTITY_TYPES.map((type) => {
            const options = entities[type] ?? [];
            if (options.length === 0) return null;
            const selectedSet = selected[type] ?? new Set<string>();
            const allChecked = options.every((o) => selectedSet.has(o.id));
            return (
              <fieldset key={type} className="block">
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-xs uppercase tracking-widest text-ember/80">
                    {TYPE_LABELS[type]} ({selectedSet.size}/{options.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      toggleAll(
                        type,
                        options.map((o) => o.id),
                        !allChecked
                      )
                    }
                    className="text-xs text-gold hover:underline"
                  >
                    {allChecked ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-3 max-h-48 overflow-y-auto rounded-lg border border-gold/20 p-3">
                  {options.map((o) => (
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
      )}

      <FormActions />
    </form>
  );
}
