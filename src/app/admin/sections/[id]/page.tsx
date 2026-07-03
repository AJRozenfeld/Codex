import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  adminGetSection,
  adminUpsertSection,
  adminDeleteSection,
  adminGetPlayers,
  adminGetRestrictedPlayerIds,
  adminGetArticleLists,
  adminCreateArticleList,
  adminRenameArticleList,
  adminDeleteArticleList,
  adminMoveArticleList,
  adminAddArticleListItem,
  adminRemoveArticleListItem,
  adminMoveArticleListItem,
  adminGetEntityOptions,
  adminGetArticleOptions,
  adminGetTemplates,
  SECTION_ENTITY_TYPE_LABELS,
} from "@/lib/admin-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { SECTION_ENTITY_TYPES, type SectionEntityType } from "@/lib/types";
import { Field, Select, RevealedToggle, CheckboxGroup, FormActions } from "@/components/AdminForm";

const TEMPLATE_PREFIX = "template:";

export const dynamic = "force-dynamic";

async function saveAction(id: string | undefined, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const newId = await adminUpsertSection(
    campaignId,
    {
      name: String(formData.get("name") ?? ""),
      revealed: formData.get("revealed") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0),
      restrictedPlayerIds: formData.getAll("restrictedPlayerIds").map(String),
    },
    id
  );
  redirect(id ? "/admin/sections" : `/admin/sections/${newId}`);
}

async function deleteAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteSection(campaignId, id);
  redirect("/admin/sections");
}

async function createListAction(sectionId: string, formData: FormData) {
  "use server";
  const raw = String(formData.get("entityType") ?? "");
  const name = String(formData.get("listName") ?? "");
  if (!name) return;
  if (raw.startsWith(TEMPLATE_PREFIX)) {
    const templateId = raw.slice(TEMPLATE_PREFIX.length);
    if (!templateId) return;
    await adminCreateArticleList(sectionId, { entityType: "custom", templateId, name });
  } else {
    const entityType = raw as (typeof SECTION_ENTITY_TYPES)[number];
    if (!SECTION_ENTITY_TYPES.includes(entityType)) return;
    await adminCreateArticleList(sectionId, { entityType, name });
  }
  redirect(`/admin/sections/${sectionId}`);
}

async function renameListAction(sectionId: string, listId: string, formData: FormData) {
  "use server";
  const name = String(formData.get(`listName-${listId}`) ?? "");
  if (!name) return;
  await adminRenameArticleList(listId, name);
  redirect(`/admin/sections/${sectionId}`);
}

async function deleteListAction(sectionId: string, listId: string) {
  "use server";
  await adminDeleteArticleList(listId);
  redirect(`/admin/sections/${sectionId}`);
}

async function moveListAction(sectionId: string, listId: string, direction: "up" | "down") {
  "use server";
  await adminMoveArticleList(sectionId, listId, direction);
  redirect(`/admin/sections/${sectionId}`);
}

async function addItemAction(sectionId: string, listId: string, formData: FormData) {
  "use server";
  const entityId = String(formData.get(`entityId-${listId}`) ?? "");
  if (!entityId) return;
  await adminAddArticleListItem(listId, entityId);
  redirect(`/admin/sections/${sectionId}`);
}

async function removeItemAction(sectionId: string, itemId: string) {
  "use server";
  await adminRemoveArticleListItem(itemId);
  redirect(`/admin/sections/${sectionId}`);
}

async function moveItemAction(sectionId: string, listId: string, itemId: string, direction: "up" | "down") {
  "use server";
  await adminMoveArticleListItem(listId, itemId, direction);
  redirect(`/admin/sections/${sectionId}`);
}

export default async function AdminSectionEditPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const campaignId = await getCurrentCampaignId();
  const [section, players, selectedRestrictedIds] = await Promise.all([
    isNew ? Promise.resolve(null) : adminGetSection(campaignId, params.id),
    adminGetPlayers(campaignId),
    isNew ? Promise.resolve([]) : adminGetRestrictedPlayerIds("sections", params.id),
  ]);
  if (!isNew && !section) notFound();

  const lists = isNew ? [] : await adminGetArticleLists(campaignId, params.id);
  const templates = isNew ? [] : await adminGetTemplates();

  const save = saveAction.bind(null, isNew ? undefined : params.id);
  const del = deleteAction.bind(null, params.id);
  const createList = createListAction.bind(null, params.id);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl text-gold mb-6">{isNew ? "New Section" : `Edit: ${section!.name}`}</h1>
      <form action={save} className="space-y-4">
        <Field label="Section Name" name="name" defaultValue={section?.name} required />
        <Field label="Sort order" name="sortOrder" type="number" defaultValue={String(section?.sortOrder ?? 0)} />
        <RevealedToggle defaultChecked={section ? section.revealed : true} />
        <CheckboxGroup
          label="Restrict to specific players (leave empty = visible to every player)"
          name="restrictedPlayerIds"
          options={players.map((p) => ({ value: p.id, label: p.displayName }))}
          selected={selectedRestrictedIds}
        />
        <FormActions deleteAction={isNew ? undefined : del} />
      </form>

      {!isNew && section && (
        <div className="mt-10 space-y-6">
          <h2 className="font-display text-xl text-gold">Article Lists</h2>
          <p className="text-sm text-parchment/50 -mt-4">
            Each list shows a curated, ordered set of one existing content type on the public page.
          </p>

          {lists.map((list, listIndex) => (
            <ArticleListEditor
              key={list.id}
              sectionId={params.id}
              list={list}
              campaignId={campaignId}
              isFirst={listIndex === 0}
              isLast={listIndex === lists.length - 1}
              renameAction={renameListAction.bind(null, params.id, list.id)}
              deleteAction={deleteListAction.bind(null, params.id, list.id)}
              moveUpAction={moveListAction.bind(null, params.id, list.id, "up")}
              moveDownAction={moveListAction.bind(null, params.id, list.id, "down")}
              addItemAction={addItemAction.bind(null, params.id, list.id)}
              removeItemAction={removeItemAction.bind(null, params.id)}
              moveItemUpAction={(itemId: string) => moveItemAction.bind(null, params.id, list.id, itemId, "up")}
              moveItemDownAction={(itemId: string) => moveItemAction.bind(null, params.id, list.id, itemId, "down")}
            />
          ))}

          <div className="rounded-lg border border-dashed border-gold/25 p-5">
            <h3 className="font-display text-sm text-gold mb-3">+ Add List</h3>
            <form action={createList} className="flex flex-wrap items-end gap-3">
              <Field label="List Header" name="listName" className="flex-1 min-w-[10rem]" required />
              <label className="block">
                <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Article Type</span>
                <select
                  name="entityType"
                  defaultValue=""
                  required
                  className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment focus:outline-none focus:border-gold/70"
                >
                  <option value="" disabled>&mdash;</option>
                  <optgroup label="Built-in">
                    {SECTION_ENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>{SECTION_ENTITY_TYPE_LABELS[t]}</option>
                    ))}
                  </optgroup>
                  {templates.length > 0 && (
                    <optgroup label="Custom Templates">
                      {templates.map((t) => (
                        <option key={t.id} value={`${TEMPLATE_PREFIX}${t.id}`}>{t.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold h-fit">
                Create List
              </button>
            </form>
            {templates.length === 0 && (
              <p className="text-xs text-parchment/40 mt-2">
                No custom templates yet - create one under{" "}
                <Link href="/admin/templates" className="text-gold hover:underline">Templates</Link> to add fully
                custom article types here.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function ArticleListEditor({
  sectionId,
  list,
  campaignId,
  isFirst,
  isLast,
  renameAction,
  deleteAction,
  moveUpAction,
  moveDownAction,
  addItemAction,
  removeItemAction,
  moveItemUpAction,
  moveItemDownAction,
}: {
  sectionId: string;
  list: Awaited<ReturnType<typeof adminGetArticleLists>>[number];
  campaignId: string;
  isFirst: boolean;
  isLast: boolean;
  renameAction: (formData: FormData) => Promise<void>;
  deleteAction: () => Promise<void>;
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
  addItemAction: (formData: FormData) => Promise<void>;
  removeItemAction: (itemId: string) => Promise<void>;
  moveItemUpAction: (itemId: string) => (formData: FormData) => Promise<void>;
  moveItemDownAction: (itemId: string) => (formData: FormData) => Promise<void>;
}) {
  const isCustom = list.entityType === "custom" && !!list.templateId;
  const allOptions = isCustom
    ? await adminGetArticleOptions(campaignId, list.templateId!)
    : await adminGetEntityOptions(campaignId, list.entityType as Exclude<SectionEntityType, "custom">);
  const addedIds = new Set(list.items.map((i) => i.entityId));
  const availableOptions = allOptions.filter((o) => !addedIds.has(o.id));
  const typeLabel = isCustom ? `Custom: ${list.templateName ?? "(template deleted)"}` : SECTION_ENTITY_TYPE_LABELS[list.entityType as Exclude<SectionEntityType, "custom">];

  return (
    <div className="rounded-lg border border-gold/20 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <form action={renameAction} className="flex items-center gap-2 flex-1 min-w-[14rem]">
          <input
            name={`listName-${list.id}`}
            defaultValue={list.name}
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-parchment text-sm focus:outline-none focus:border-gold/70"
          />
          <button type="submit" className="text-xs text-gold hover:underline whitespace-nowrap">Rename</button>
        </form>
        <span className="text-xs uppercase tracking-widest text-ember/70 whitespace-nowrap">
          {typeLabel}
        </span>
        <div className="flex items-center gap-2">
          <form action={moveUpAction}>
            <button type="submit" disabled={isFirst} className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20">&uarr; Up</button>
          </form>
          <form action={moveDownAction}>
            <button type="submit" disabled={isLast} className="text-xs text-parchment/60 hover:text-gold disabled:opacity-20">&darr; Down</button>
          </form>
          <form action={deleteAction}>
            <button type="submit" className="text-xs text-blood hover:underline">Delete List</button>
          </form>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5">
        {list.items.map((item, itemIndex) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded bg-void/40 px-3 py-1.5">
            <span className="text-sm text-parchment">{item.title}</span>
            <div className="flex items-center gap-3">
              {isCustom && (
                <Link
                  href={`/admin/articles/${item.entityId}?campaignId=${campaignId}&templateId=${list.templateId}&sectionId=${sectionId}`}
                  className="text-xs text-gold hover:underline"
                >
                  Edit
                </Link>
              )}
              <form action={moveItemUpAction(item.id)}>
                <button type="submit" disabled={itemIndex === 0} className="text-xs text-parchment/50 hover:text-gold disabled:opacity-20">&uarr;</button>
              </form>
              <form action={moveItemDownAction(item.id)}>
                <button type="submit" disabled={itemIndex === list.items.length - 1} className="text-xs text-parchment/50 hover:text-gold disabled:opacity-20">&darr;</button>
              </form>
              <form action={removeItemAction.bind(null, item.id)}>
                <button type="submit" className="text-xs text-blood/80 hover:underline">Remove</button>
              </form>
            </div>
          </li>
        ))}
        {list.items.length === 0 && <li className="text-xs text-parchment/40 px-3 py-1">No articles in this list yet.</li>}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form action={addItemAction} className="flex items-center gap-2 flex-1 min-w-[16rem]">
          <select
            name={`entityId-${list.id}`}
            defaultValue=""
            className="flex-1 rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment focus:outline-none focus:border-gold/70"
          >
            <option value="" disabled>
              &mdash; choose existing &mdash;
            </option>
            {availableOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={availableOptions.length === 0}
            className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10 disabled:opacity-30 whitespace-nowrap"
          >
            + Add Existing
          </button>
        </form>
        {isCustom && (
          <Link
            href={`/admin/articles/new?campaignId=${campaignId}&templateId=${list.templateId}&sectionId=${sectionId}&listId=${list.id}`}
            className="rounded-full bg-gold/90 text-ink px-3 py-1.5 text-xs font-medium hover:bg-gold whitespace-nowrap"
          >
            + Create New Article
          </Link>
        )}
      </div>
    </div>
  );
}
