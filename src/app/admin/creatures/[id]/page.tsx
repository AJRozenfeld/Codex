import { notFound, redirect } from "next/navigation";
import { getCreature, upsertCreature, deleteCreature } from "@/lib/creature-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, FormActions } from "@/components/AdminForm";
import { CreatureStatBlockForm } from "@/components/CreatureStatBlockForm";
import type { MonsterStatBlock } from "@/lib/types";

export const dynamic = "force-dynamic";

async function updateBasicsAction(id: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const hpRaw = String(formData.get("hp") ?? "").trim();
  const acRaw = String(formData.get("ac") ?? "").trim();
  const initBonusRaw = String(formData.get("initBonus") ?? "").trim();
  const existing = await getCreature(campaignId, id);
  await upsertCreature(
    campaignId,
    {
      name,
      hp: hpRaw ? Number(hpRaw) : null,
      ac: acRaw ? Number(acRaw) : null,
      initBonus: initBonusRaw ? Number(initBonusRaw) : 0,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
      portraitPath: String(formData.get("portraitPath") ?? "").trim() || null,
      source: String(formData.get("source") ?? "").trim() || null,
      statBlock: existing?.statBlock,
    },
    id
  );
  redirect(`/admin/creatures/${id}`);
}

async function updateStatBlockAction(id: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const existing = await getCreature(campaignId, id);
  if (!existing) return;
  const raw = String(formData.get("statBlockData") ?? "{}");
  let statBlock: Partial<MonsterStatBlock>;
  try {
    statBlock = JSON.parse(raw);
  } catch {
    return;
  }
  await upsertCreature(
    campaignId,
    {
      name: existing.name,
      hp: existing.hp,
      ac: existing.ac,
      initBonus: existing.initBonus,
      notes: existing.notes ?? undefined,
      portraitPath: existing.portraitPath,
      source: existing.source,
      statBlock,
    },
    id
  );
  redirect(`/admin/creatures/${id}`);
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteCreature(campaignId, id);
  redirect("/admin/creatures");
}

export default async function AdminCreatureEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const creature = await getCreature(campaignId, params.id);
  if (!creature) notFound();

  const updateBasics = updateBasicsAction.bind(null, params.id);
  const updateStatBlock = updateStatBlockAction.bind(null, params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="font-display text-2xl text-gold mb-6">Edit Creature: {creature.name}</h1>
        <form action={updateBasics} className="space-y-4 rounded-lg border border-gold/15 p-4">
          <Field label="Name" name="name" defaultValue={creature.name} required />
          <div className="grid grid-cols-3 gap-3">
            <Field label="HP" name="hp" type="number" defaultValue={creature.hp !== null ? String(creature.hp) : ""} />
            <Field label="AC" name="ac" type="number" defaultValue={creature.ac !== null ? String(creature.ac) : ""} />
            <Field label="Initiative Bonus" name="initBonus" type="number" defaultValue={String(creature.initBonus)} />
          </div>
          <p className="text-xs text-parchment/40 -mt-1">
            These three feed Scenes' auto-rolled initiative directly - keep HP/AC/init bonus in sync with the ability
            scores below if you change them (init bonus is usually the Dex modifier).
          </p>
          <Field label="Portrait URL" name="portraitPath" defaultValue={creature.portraitPath ?? ""} placeholder="/images/monsters/goblin.png" />
          <Field label="Source / Attribution" name="source" defaultValue={creature.source ?? ""} placeholder="e.g. SRD 5.1 (CC BY 4.0), or Homebrew" />
          <TextArea label="DM Notes (private reminders, distinct from the stat block)" name="notes" defaultValue={creature.notes} rows={3} />
          <FormActions deleteAction={del} />
        </form>
      </div>

      <div>
        <h2 className="font-display text-xl text-gold mb-4">Stat Block</h2>
        <CreatureStatBlockForm initialData={creature.statBlock} saveAction={updateStatBlock} submitLabel="Save Stat Block" />
      </div>
    </div>
  );
}
