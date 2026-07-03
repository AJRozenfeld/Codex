import { notFound } from "next/navigation";
import { getArticleBySlug, resolveReferenceField, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EntityCard } from "@/components/Card";
import type { TemplateField, ArticleListItemSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const result = await getArticleBySlug(params.slug, viewer);
  if (!result) notFound();
  const { article, template } = result;

  const titleField = template.fields.find((f) => f.role === "title");
  const subtitleField = template.fields.find((f) => f.role === "subtitle");
  const descriptionField = template.fields.find((f) => f.role === "description");
  const imageField = template.fields.find((f) => f.role === "image");

  const title = titleField ? String(article.data[titleField.key] ?? "") : template.name;
  const subtitle = subtitleField ? article.data[subtitleField.key] : null;
  const description = descriptionField ? article.data[descriptionField.key] : null;
  const imageUrl = imageField ? article.data[imageField.key] : null;

  // Every field that isn't already surfaced as the hero title/subtitle/description/image
  // renders below as a labeled row, in the template's own field order - headings included
  // as plain section dividers.
  const roleFieldIds = new Set([titleField?.id, subtitleField?.id, descriptionField?.id, imageField?.id].filter(Boolean));
  const remainingFields = template.fields.filter((f) => !roleFieldIds.has(f.id));

  // Reference fields (Phase 3) resolve to a set of linked cards rather than
  // plain text, so their targets are fetched up front here (server side,
  // same access/redaction rules as everything else) and handed to the
  // display component per field id.
  const referenceSummaries = new Map<string, ArticleListItemSummary[]>();
  for (const field of remainingFields) {
    if (field.fieldType === "reference") {
      referenceSummaries.set(field.id, await resolveReferenceField(field, article.data[field.key], viewer));
    }
  }

  // "Referenced By" - every article (any template, any campaign-matching
  // viewer) whose own reference field points at this one. See
  // getBacklinksForEntity in queries.ts.
  const backlinks = await getBacklinksForEntity(article.id, viewer);

  return (
    <div className="max-w-2xl">
      <div className="text-xs uppercase tracking-widest text-ember/70 mb-2">{template.name}</div>
      <SectionHeading title={title} />

      <div className="flex flex-col sm:flex-row gap-6 mb-8">
        {typeof imageUrl === "string" && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="w-full sm:w-56 rounded-lg object-cover border border-gold/20 flex-shrink-0" />
        )}
        <div className="flex-1">
          {subtitle != null && subtitle !== "" && <div className="text-parchment/60 mb-2">{String(subtitle)}</div>}
          {description != null && description !== "" && (
            <p className="text-parchment/80 whitespace-pre-wrap">{String(description)}</p>
          )}
        </div>
      </div>

      {remainingFields.length > 0 && (
        <div className="space-y-4">
          {remainingFields.map((field) => (
            <ArticleFieldDisplay
              key={field.id}
              field={field}
              value={article.data[field.key]}
              referencedItems={referenceSummaries.get(field.id)}
            />
          ))}
        </div>
      )}

      {backlinks.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl text-gold mb-4">Referenced By</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {backlinks.map((b) => (
              <EntityCard key={b.entityId} href={b.href} title={b.title} subtitle={b.subtitle} description={b.description} imageUrl={b.imagePath} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ArticleFieldDisplay({
  field,
  value,
  referencedItems,
}: {
  field: TemplateField;
  value: string | number | boolean | string[] | null | undefined;
  referencedItems?: ArticleListItemSummary[];
}) {
  if (field.fieldType === "heading") {
    return <h2 className="font-display text-lg text-gold pt-4 border-t border-gold/15">{field.label}</h2>;
  }
  if (field.fieldType === "reference") {
    if (!referencedItems || referencedItems.length === 0) return null;
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-ember/70 mb-2">{field.label}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {referencedItems.map((item) => (
            <EntityCard key={item.entityId} href={item.href} title={item.title} subtitle={item.subtitle} description={item.description} imageUrl={item.imagePath} />
          ))}
        </div>
      </div>
    );
  }
  if (value == null || value === "") return null;
  if (field.fieldType === "image") {
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-ember/70 mb-1">{field.label}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={String(value)} alt={field.label} className="max-w-xs rounded-lg border border-gold/20" />
      </div>
    );
  }
  if (field.fieldType === "checkbox") {
    return (
      <div>
        <div className="text-xs uppercase tracking-widest text-ember/70 mb-1">{field.label}</div>
        <div className="text-parchment/80">{value ? "Yes" : "No"}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-ember/70 mb-1">{field.label}</div>
      <div className="text-parchment/80 whitespace-pre-wrap">{String(value)}</div>
    </div>
  );
}
