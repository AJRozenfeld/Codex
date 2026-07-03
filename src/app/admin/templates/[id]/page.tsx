import { notFound, redirect } from "next/navigation";
import {
  adminGetTemplate,
  adminUpsertTemplate,
  adminDeleteTemplate,
  adminCreateTemplateField,
  adminUpdateTemplateField,
  adminDeleteTemplateField,
  adminMoveTemplateField,
} from "@/lib/admin-queries";
import type { TemplateFieldType, TemplateFieldRole, TemplateField } from "@/lib/types";
import { Field, TextArea, Select, FormActions } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

const FIELD_TYPE_OPTIONS: { value: TemplateFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text (paragraph)" },
  { value: "number", label: "Number" },
  { value: "image", label: "Image upload" },
  { value: "checkbox", label: "Yes / No" },
  { value: "heading", label: "Section heading (display only, no data)" },
];

const FIELD_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "(none)" },
  { value: "title", label: "Title - card & page heading" },
  { value: "subtitle", label: "Subtitle - shown under the title" },
  { value: "description", label: "Description - shown as body text on cards" },
  { value: "image", label: "Image - shown as the card thumbnail" },
];

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const newId = await adminUpsertTemplate(
    {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || null,
    },
    id
  );
  redirect(id ? "/admin/templates" : `/admin/templates/${newId}`);
}

async function deleteAction(id: string) {
  "use server";
  const result = await adminDeleteTemplate(id);
  redirect(result.deleted ? "/admin/templates" : `/admin/templates?blockedDelete=${result.articleCount}`);
}

async function addFieldAction(templateId: string, formData: FormData) {
  "use server";
  const label = String(formData.get("label") ?? "");
  const fieldType = String(formData.get("fieldType") ?? "text") as TemplateFieldType;
  const roleRaw = String(formData.get("role") ?? "");
  if (!label) return;
  await adminCreateTemplateField(templateId, { label, fieldType, role: (roleRaw || null) as TemplateFieldRole | null });
  redirect(`/admin/templates/${templateId}`);
}

async function updateFieldAction(templateId: string, fieldId: string, formData: FormData) {
  "use server";
  const label = String(formData.get(`label-${fieldId}`) ?? "");
  const fieldType = String(formData.get(`fieldType-${fieldId}`) ?? "text") as TemplateFieldType;
  const roleRaw = String(formData.get(`role-${fieldId}`) ?? "");
  if (!label) return;
  await adminUpdateTemplateField(templateId, fieldId, { label, fieldType, role: (roleRaw || null) as TemplateFieldRole | null });
  redirect(`/admin/templates/${templateId}`);
}

async function deleteFieldAction(templateId: string, fieldId: string) {
  "use server";
  await adminDeleteTemplateField(fieldId);
  redirect(`/admin/templates/${templateId}`);
}

async function moveFieldAction(templateId: string, fieldId: string, direction: "up" | "down") {
  "use server";
  await adminMoveTemplateField(templateId, fieldId, direction);
  redirect(`/admin/templates/${templateId}`);
}

export default async function AdminTemplateEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const template = isNew ? null : await adminGetTemplate(params.id);
  if (!isNew && !template) notFound();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);
  const addField = addFieldAction.bind(null, params.id);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl text-gold mb-2">{isNew ? "New Template" : `Edit: ${template!.name}`}</h1>
      <p className="text-sm text-parchment/50 mb-6 max-w-xl">
        Shared across every campaign - a template you build here is available to any section, in any campaign, not
        just the one you're currently editing.
      </p>
      <form action={save} className="space-y-4">
        <Field label="Template Name" name="name" defaultValue={template?.name} required />
        <TextArea label="Description (DM-facing note, optional)" name="description" defaultValue={template?.description} rows={2} />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>

      {!isNew && template && (
        <div className="mt-10 space-y-6">
          <h2 className="font-display text-xl text-gold">Fields</h2>
          <p className="text-sm text-parchment/50 -mt-4">
            Mark exactly one field as the Title - it becomes the card heading and detail-page title everywhere this
            template is used.
          </p>

          <div className="rounded-lg border border-gold/20 divide-y divide-gold/10">
            {template.fields.map((f, i) => (
              <TemplateFieldRow
                key={f.id}
                field={f}
                isFirst={i === 0}
                isLast={i === template.fields.length - 1}
                updateAction={updateFieldAction.bind(null, params.id, f.id)}
                deleteAction={deleteFieldAction.bind(null, params.id, f.id)}
                moveUpAction={moveFieldAction.bind(null, params.id, f.id, "up")}
                moveDownAction={moveFieldAction.bind(null, params.id, f.id, "down")}
              />
            ))}
            {template.fields.length === 0 && (
              <div className="px-4 py-4 text-sm text-parchment/40">No fields yet - add one below.</div>
            )}
          </div>

          <div className="rounded-lg border border-dashed border-gold/25 p-5">
            <h3 className="font-display text-sm text-gold mb-3">+ Add Field</h3>
            <form action={addField} className="flex flex-wrap items-end gap-3">
              <Field label="Field Label" name="label" className="flex-1 min-w-[10rem]" required />
              <Select label="Type" name="fieldType" options={FIELD_TYPE_OPTIONS} required />
              <Select label="Role" name="role" options={FIELD_ROLE_OPTIONS.filter((o) => o.value)} />
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold h-fit">
                Add Field
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateFieldRow({
  field,
  isFirst,
  isLast,
  updateAction,
  deleteAction,
  moveUpAction,
  moveDownAction,
}: {
  field: TemplateField;
  isFirst: boolean;
  isLast: boolean;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: () => Promise<void>;
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
}) {
  return (
    <div className="px-4 py-3">
      <form action={updateAction} className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[9rem]">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Label</span>
          <input
            name={`label-${field.id}`}
            defaultValue={field.label}
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-parchment text-sm focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Type</span>
          <select
            name={`fieldType-${field.id}`}
            defaultValue={field.fieldType}
            className="rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Role</span>
          <select
            name={`role-${field.id}`}
            defaultValue={field.role ?? ""}
            className="rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
          >
            {FIELD_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="text-xs text-gold hover:underline whitespace-nowrap">Save</button>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-parchment/30 font-mono">{field.key}</span>
        </div>
      </form>
      <div className="flex items-center gap-3 mt-2">
        <form action={moveUpAction}>
          <button type="submit" disabled={isFirst} className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20">&uarr; Up</button>
        </form>
        <form action={moveDownAction}>
          <button type="submit" disabled={isLast} className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20">&darr; Down</button>
        </form>
        <form action={deleteAction}>
          <button type="submit" className="text-xs text-blood hover:underline">Delete Field</button>
        </form>
      </div>
    </div>
  );
}
