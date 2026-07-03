import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  adminGetArticle,
  adminUpsertArticle,
  adminDeleteArticle,
  adminGetTemplate,
  adminAddArticleListItem,
} from "@/lib/admin-queries";
import { uploadImage } from "@/lib/blob-storage";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import type { ArticleData, TemplateField } from "@/lib/types";
import { Field, TextArea, RevealedToggle, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function saveAction(
  articleId: string | undefined,
  campaignId: string,
  templateId: string,
  sectionId: string | undefined,
  listId: string | undefined,
  formData: FormData
) {
  "use server";
  const template = await adminGetTemplate(templateId);
  if (!template) redirect(sectionId ? `/admin/sections/${sectionId}` : "/admin/templates");

  const existing = articleId ? await adminGetArticle(campaignId, articleId) : null;
  const data: ArticleData = {};
  for (const field of template!.fields) {
    if (field.fieldType === "heading") continue;
    if (field.fieldType === "image") {
      const file = formData.get(field.key);
      if (file instanceof File && file.size > 0) {
        data[field.key] = await uploadImage(file, "articles");
      } else {
        data[field.key] = existing?.data[field.key] ?? null;
      }
    } else if (field.fieldType === "checkbox") {
      data[field.key] = formData.get(field.key) === "on";
    } else if (field.fieldType === "number") {
      const raw = formData.get(field.key);
      data[field.key] = raw != null && raw !== "" ? Number(raw) : null;
    } else {
      data[field.key] = String(formData.get(field.key) ?? "");
    }
  }

  const revealed = formData.get("revealed") === "on";
  const newArticleId = await adminUpsertArticle(campaignId, templateId, { data, revealed }, articleId);
  if (!articleId && listId) {
    await adminAddArticleListItem(listId, newArticleId);
  }
  redirect(sectionId ? `/admin/sections/${sectionId}` : "/admin/templates");
}

async function deleteAction(campaignId: string, sectionId: string | undefined, id: string) {
  "use server";
  await adminDeleteArticle(campaignId, id);
  redirect(sectionId ? `/admin/sections/${sectionId}` : "/admin/templates");
}

export default async function AdminArticleEditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { campaignId?: string; templateId?: string; sectionId?: string; listId?: string };
}) {
  const isNew = params.id === "new";
  const campaignId = searchParams.campaignId || (await getCurrentCampaignId());
  const existing = isNew ? null : await adminGetArticle(campaignId, params.id);
  if (!isNew && !existing) notFound();

  const templateId = isNew ? searchParams.templateId : existing!.templateId;
  if (!templateId) notFound();
  const template = await adminGetTemplate(templateId);
  if (!template) notFound();

  const sectionId = searchParams.sectionId;
  const listId = isNew ? searchParams.listId : undefined;

  const save = saveAction.bind(null, isNew ? undefined : params.id, campaignId, templateId, sectionId, listId);
  const del = deleteAction.bind(null, campaignId, sectionId, params.id);

  return (
    <div className="max-w-2xl">
      {sectionId && (
        <Link href={`/admin/sections/${sectionId}`} className="text-xs text-parchment/50 hover:text-gold">
          &larr; Back to section
        </Link>
      )}
      <h1 className="font-display text-2xl text-gold mt-2 mb-1">
        {isNew ? `New ${template.name}` : `Edit ${template.name}`}
      </h1>
      <p className="text-sm text-parchment/40 mb-6">Template: {template.name}</p>
      <form action={save} className="space-y-4">
        {template.fields.map((field) => (
          <ArticleFieldInput key={field.id} field={field} value={existing?.data[field.key] ?? null} />
        ))}
        <RevealedToggle defaultChecked={existing ? existing.revealed : true} />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>
    </div>
  );
}

function ArticleFieldInput({ field, value }: { field: TemplateField; value: string | number | boolean | null }) {
  if (field.fieldType === "heading") {
    return <h3 className="font-display text-sm text-ember pt-2 border-t border-gold/10">{field.label}</h3>;
  }
  if (field.fieldType === "textarea") {
    return <TextArea label={field.label} name={field.key} defaultValue={value != null ? String(value) : ""} />;
  }
  if (field.fieldType === "number") {
    return <Field label={field.label} name={field.key} type="number" defaultValue={value != null ? String(value) : ""} />;
  }
  if (field.fieldType === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-parchment/70">
        <input type="checkbox" name={field.key} defaultChecked={value === true} className="accent-gold" />
        {field.label}
      </label>
    );
  }
  if (field.fieldType === "image") {
    const currentUrl = typeof value === "string" ? value : null;
    return (
      <div className="flex items-start gap-4">
        {currentUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt={field.label} className="h-20 w-20 rounded-lg object-cover border border-gold/20" />
        )}
        <label className="block flex-1">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">
            {field.label} {currentUrl ? "(leave blank to keep current image)" : ""}
          </span>
          <input
            type="file"
            name={field.key}
            accept="image/*"
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        </label>
      </div>
    );
  }
  // "text"
  return <Field label={field.label} name={field.key} defaultValue={value != null ? String(value) : ""} />;
}
