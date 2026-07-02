import { notFound, redirect } from "next/navigation";
import {
  adminGetPlayer,
  adminUpsertPlayer,
  adminDeletePlayer,
  adminGetCharacters,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, Select, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const password = String(formData.get("password") ?? "");
  await adminUpsertPlayer(
    campaignId,
    {
      username: String(formData.get("username") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      characterId: String(formData.get("characterId") ?? "") || null,
      password: password || undefined,
    },
    id
  );
  redirect("/admin/players");
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeletePlayer(campaignId, id);
  redirect("/admin/players");
}

export default async function AdminPlayerEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [player, characters] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetPlayer(campaignId, params.id),
    adminGetCharacters(campaignId),
  ]);
  if (!isNew && !player) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Player" : `Edit: ${player!.displayName}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Display Name" name="displayName" defaultValue={player?.displayName} required />
        <Field label="Username" name="username" defaultValue={player?.username} required />
        <Select
          label="Linked Character"
          name="characterId"
          defaultValue={player?.characterId ?? ""}
          options={characters.filter((c) => c.isPc).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Field
          label={isNew ? "Password" : "New Password (leave blank to keep current)"}
          name="password"
          type="password"
          required={isNew}
        />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>
    </div>
  );
}
