import { notFound, redirect } from "next/navigation";
import {
  getEquipmentItem, getLibraryEquipmentItem, upsertEquipmentItem, upsertLibraryEquipmentItem,
  deleteEquipmentItem, deleteLibraryEquipmentItem, copyLibraryEquipmentToCampaign,
} from "@/lib/library-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getMasterSession } from "@/lib/auth";
import { Field, TextArea, FormActions } from "@/components/AdminForm";
import type { EquipmentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim() || null,
    rarity: String(formData.get("rarity") ?? "").trim() || null,
    cost: String(formData.get("cost") ?? "").trim() || null,
    weight: String(formData.get("weight") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || null,
    details: {
      statLine: String(formData.get("statLine") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
    },
  };
}

async function saveAction(id: string, formData: FormData) {
  "use server";
  const input = parseInput(formData);
  if (!input.name) return;
  const campaignId = await getCurrentCampaignId();
  const item = await getEquipmentItem(campaignId, id);
  if (!item) return;
  if (item.campaignId === null) {
    const master = await getMasterSession();
    if (!master.isMaster) return;
    await upsertLibraryEquipmentItem(input, id);
  } else {
    await upsertEquipmentItem(item.campaignId, input, id);
  }
  redirect(`/admin/equipment/${id}`);
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const item = await getEquipmentItem(campaignId, id);
  if (!item) return;
  if (item.campaignId === null) {
    const master = await getMasterSession();
    if (!master.isMaster) return;
    await deleteLibraryEquipmentItem(id);
  } else {
    await deleteEquipmentItem(item.campaignId, id);
  }
  redirect("/admin/equipment");
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const src = await getLibraryEquipmentItem(id);
  if (!src) return;
  const newId = await copyLibraryEquipmentToCampaign(campaignId, id);
  redirect(newId ? `/admin/equipment/${newId}` : "/admin/equipment");
}

function ReadOnlyItem({ item }: { item: EquipmentItem }) {
  return (
    <div className="rounded-lg border border-gold/20 p-5 space-y-4 shadow-card">
      <p className="text-sm italic text-parchment/60">
        {[item.category, item.rarity].filter(Boolean).join(" · ")}
        {item.cost ? ` · ${item.cost}` : ""}{item.weight ? ` · ${item.weight}` : ""}
      </p>
      {item.details.statLine && <p className="text-sm text-parchment font-semibold">{item.details.statLine}</p>}
      {item.details.description && <div className="text-sm text-parchment/80 whitespace-pre-line">{item.details.description}</div>}
    </div>
  );
}

export default async function AdminEquipmentEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const item = await getEquipmentItem(campaignId, params.id);
  if (!item) notFound();
  const isLibrary = item.campaignId === null;
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
            <h1 className="font-display text-2xl text-gold mb-1">{item.name}</h1>
            <p className="text-xs uppercase tracking-widest text-ember/80">
              Platform Library{item.source ? ` · ${item.source}` : ""}
            </p>
          </div>
          <form action={copy}>
            <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
              Copy to Campaign &amp; Edit
            </button>
          </form>
        </div>
        <p className="text-sm text-parchment/50">
          Library items are shared with every DM and can&apos;t be edited directly - copy one into your campaign to customize it.
        </p>
        <ReadOnlyItem item={item} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {isLibrary && (
        <p className="rounded-lg border border-gold/30 bg-void/40 px-4 py-3 text-sm text-parchment/80">
          <span className="font-semibold text-gold">Master console:</span> you are editing a{" "}
          <span className="font-semibold">platform library</span> item - changes are visible to every DM.
        </p>
      )}
      <h1 className="font-display text-2xl text-gold">Edit Item: {item.name}</h1>
      <form action={save} className="space-y-4 rounded-lg border border-gold/15 p-4">
        <Field label="Name" name="name" defaultValue={item.name} required />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Category" name="category" defaultValue={item.category ?? ""} placeholder="Weapon / Armor / ..." />
          <Field label="Rarity" name="rarity" defaultValue={item.rarity ?? ""} placeholder="(magic items)" />
          <Field label="Cost" name="cost" defaultValue={item.cost ?? ""} placeholder="15 gp" />
          <Field label="Weight" name="weight" defaultValue={item.weight ?? ""} placeholder="3 lb." />
        </div>
        <Field label="Stat Line (one-line mechanical summary)" name="statLine" defaultValue={item.details.statLine} placeholder="Martial Melee Weapon - 1d8 slashing - Versatile (1d10)" />
        <TextArea label="Description" name="description" defaultValue={item.details.description} rows={8} />
        <Field label="Source / Attribution" name="source" defaultValue={item.source ?? ""} placeholder="e.g. SRD 5.1 (CC BY 4.0), or Homebrew" />
        <FormActions deleteAction={del} />
      </form>
    </div>
  );
}
