import { notFound, redirect } from "next/navigation";
import { noticePath } from "@/lib/friendly-errors";
import {
  getSpell, getLibrarySpell, upsertSpell, upsertLibrarySpell,
  deleteSpell, deleteLibrarySpell, copyLibrarySpellToCampaign,
} from "@/lib/library-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getMasterSession } from "@/lib/auth";
import { Field, TextArea, FormActions } from "@/components/AdminForm";
import type { Spell } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseInput(formData: FormData) {
  const levelRaw = String(formData.get("level") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    level: levelRaw ? Math.max(0, Math.min(9, Number(levelRaw) || 0)) : 0,
    school: String(formData.get("school") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || null,
    details: {
      castingTime: String(formData.get("castingTime") ?? "").trim(),
      range: String(formData.get("range") ?? "").trim(),
      components: String(formData.get("components") ?? "").trim(),
      duration: String(formData.get("duration") ?? "").trim(),
      classes: String(formData.get("classes") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      higherLevel: String(formData.get("higherLevel") ?? "").trim(),
      ritual: formData.get("ritual") === "on",
      concentration: formData.get("concentration") === "on",
    },
  };
}

async function saveAction(id: string, formData: FormData) {
  "use server";
  const input = parseInput(formData);
  if (!input.name) return;
  const campaignId = await getCurrentCampaignId();
  const spell = await getSpell(campaignId, id);
  if (!spell) return;
  if (spell.campaignId === null) {
    const master = await getMasterSession();
    if (!master.isMaster) redirect(noticePath("Only the master console can edit platform-library content - log in at /master first.", "/admin/spells"));
    await upsertLibrarySpell(input, id);
  } else {
    await upsertSpell(spell.campaignId, input, id);
  }
  redirect(`/admin/spells/${id}`);
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const spell = await getSpell(campaignId, id);
  if (!spell) return;
  if (spell.campaignId === null) {
    const master = await getMasterSession();
    if (!master.isMaster) redirect(noticePath("Only the master console can edit platform-library content - log in at /master first.", "/admin/spells"));
    await deleteLibrarySpell(id);
  } else {
    await deleteSpell(spell.campaignId, id);
  }
  redirect("/admin/spells");
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const src = await getLibrarySpell(id);
  if (!src) return;
  const newId = await copyLibrarySpellToCampaign(campaignId, id);
  redirect(newId ? `/admin/spells/${newId}` : "/admin/spells");
}

function SpellCard({ spell }: { spell: Spell }) {
  const d = spell.details;
  const levelLine = spell.level === 0 ? `${spell.school ?? ""} cantrip` : `Level ${spell.level} ${spell.school ?? ""}`;
  const row = (label: string, value: string) =>
    value ? (
      <p className="text-sm text-parchment/80">
        <span className="font-semibold text-parchment">{label}.</span> {value}
      </p>
    ) : null;
  return (
    <div className="rounded-lg border border-gold/20 p-5 space-y-4 shadow-card">
      <p className="text-sm italic text-parchment/60">
        {levelLine.trim()}{d.ritual ? " (ritual)" : ""}
      </p>
      <div className="space-y-1">
        {row("Casting Time", d.castingTime)}
        {row("Range", d.range)}
        {row("Components", d.components)}
        {row("Duration", `${d.concentration ? "Concentration, " : ""}${d.duration}`)}
        {row("Classes", d.classes)}
      </div>
      {d.description && <div className="text-sm text-parchment/80 whitespace-pre-line">{d.description}</div>}
      {d.higherLevel && (
        <p className="text-sm text-parchment/80">
          <span className="font-semibold text-parchment">At Higher Levels.</span> {d.higherLevel}
        </p>
      )}
    </div>
  );
}

export default async function AdminSpellEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const spell = await getSpell(campaignId, params.id);
  if (!spell) notFound();
  const isLibrary = spell.campaignId === null;
  const master = await getMasterSession();
  const canEdit = !isLibrary || !!master.isMaster;

  const save = saveAction.bind(null, params.id);
  const del = deleteAction.bind(null, params.id);
  const copy = copyAction.bind(null, params.id);

  if (!canEdit) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl text-gold mb-1">{spell.name}</h1>
            <p className="text-xs uppercase tracking-widest text-ember/80">
              Platform Library{spell.source ? ` · ${spell.source}` : ""}
            </p>
          </div>
          <form action={copy}>
            <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
              Copy to Campaign &amp; Edit
            </button>
          </form>
        </div>
        <p className="text-sm text-parchment/50">
          Library spells are shared with every DM and can&apos;t be edited directly - copy one into your campaign to customize it.
        </p>
        <SpellCard spell={spell} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {isLibrary && (
        <p className="rounded-lg border border-gold/30 bg-void/40 px-4 py-3 text-sm text-parchment/80">
          <span className="font-semibold text-gold">Master console:</span> you are editing a{" "}
          <span className="font-semibold">platform library</span> spell - changes are visible to every DM.
        </p>
      )}
      <h1 className="font-display text-2xl text-gold">Edit Spell: {spell.name}</h1>
      <form action={save} className="space-y-4 rounded-lg border border-gold/15 p-4">
        <Field label="Name" name="name" defaultValue={spell.name} required />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Level (0 = cantrip)" name="level" type="number" defaultValue={String(spell.level)} />
          <Field label="School" name="school" defaultValue={spell.school ?? ""} placeholder="Evocation" />
          <Field label="Casting Time" name="castingTime" defaultValue={spell.details.castingTime} placeholder="1 action" />
          <Field label="Range" name="range" defaultValue={spell.details.range} placeholder="150 feet" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Components" name="components" defaultValue={spell.details.components} placeholder="V, S, M (...)" />
          <Field label="Duration" name="duration" defaultValue={spell.details.duration} placeholder="Instantaneous" />
          <label className="flex items-center gap-2 text-sm text-parchment/80 pt-6">
            <input type="checkbox" name="concentration" defaultChecked={spell.details.concentration} className="accent-[#6e1f14]" />
            Concentration
          </label>
          <label className="flex items-center gap-2 text-sm text-parchment/80 pt-6">
            <input type="checkbox" name="ritual" defaultChecked={spell.details.ritual} className="accent-[#6e1f14]" />
            Ritual
          </label>
        </div>
        <Field label="Classes" name="classes" defaultValue={spell.details.classes} placeholder="Sorcerer, Wizard" />
        <TextArea label="Description" name="description" defaultValue={spell.details.description} rows={10} />
        <TextArea label="At Higher Levels" name="higherLevel" defaultValue={spell.details.higherLevel} rows={3} />
        <Field label="Source / Attribution" name="source" defaultValue={spell.source ?? ""} placeholder="e.g. SRD 5.1 (CC BY 4.0), or Homebrew" />
        <FormActions deleteAction={del} />
      </form>
    </div>
  );
}
