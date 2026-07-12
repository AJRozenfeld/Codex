import { notFound, redirect } from "next/navigation";
import { getCreature, upsertCreature, deleteCreature } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function updateAction(id: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const hpRaw = String(formData.get("hp") ?? "").trim();
  const acRaw = String(formData.get("ac") ?? "").trim();
  const initBonusRaw = String(formData.get("initBonus") ?? "").trim();
  await upsertCreature(
    campaignId,
    {
      name,
      hp: hpRaw ? Number(hpRaw) : null,
      ac: acRaw ? Number(acRaw) : null,
      initBonus: initBonusRaw ? Number(initBonusRaw) : 0,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
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

  const update = updateAction.bind(null, params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl text-gold mb-6">Edit Creature: {creature.name}</h1>
      <form action={update} className="space-y-4">
        <Field label="Name" name="name" defaultValue={creature.name} required />
        <div className="grid grid-cols-3 gap-3">
          <Field label="HP" name="hp" type="number" defaultValue={creature.hp !== null ? String(creature.hp) : ""} />
          <Field label="AC" name="ac" type="number" defaultValue={creature.ac !== null ? String(creature.ac) : ""} />
          <Field label="Initiative Bonus" name="initBonus" type="number" defaultValue={String(creature.initBonus)} />
        </div>
        <TextArea label="Notes (attacks, abilities, anything worth having on hand)" name="notes" defaultValue={creature.notes} rows={4} />
        <FormActions deleteAction={del} />
      </form>
    </div>
  );
}
