import { notFound, redirect } from "next/navigation";
import { adminGetMoon, adminUpsertMoon, adminDeleteMoon } from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea, Checkbox, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpsertMoon(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      cycle: String(formData.get("cycle") ?? "") || undefined,
      domain: String(formData.get("domain") ?? ""),
      description: String(formData.get("description") ?? ""),
      color: String(formData.get("color") ?? "") || undefined,
      isGoddess: formData.get("isGoddess") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0),
    },
    id
  );
  redirect("/admin/moons");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteMoon(campaignId, id);
  redirect("/admin/moons");
}

export default async function AdminMoonEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const moon = isNew ? null : await adminGetMoon(campaignId, params.id);
  if (!isNew && !moon) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Moon" : `Edit: ${moon!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Name" name="name" defaultValue={moon?.name} required />
        <Field label="Domain (e.g. War, Trickery, Harvest)" name="domain" defaultValue={moon?.domain} required />
        <Field label="Cycle (e.g. waxes every 14 days)" name="cycle" defaultValue={moon?.cycle ?? ""} />
        <Field label="Color (hex, optional)" name="color" defaultValue={moon?.color ?? ""} />
        <TextArea label="Description" name="description" defaultValue={moon?.description} required />
        <div className="flex items-center gap-4">
          <Checkbox label="Worshipped as a goddess" name="isGoddess" defaultChecked={moon?.isGoddess} />
          <Field label="Sort order" name="sortOrder" type="number" defaultValue={String(moon?.sortOrder ?? 0)} className="w-24" />
        </div>
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>
    </div>
  );
}
