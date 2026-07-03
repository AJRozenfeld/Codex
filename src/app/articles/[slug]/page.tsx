import { notFound } from "next/navigation";
import { getArticleBySlug } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading } from "@/components/Card";
import type { TemplateField } from "@/lib/types";

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
            <ArticleFieldDisplay key={field.id} field={field} value={article.data[field.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleFieldDisplay({ field, value }: { field: TemplateField; value: string | number | boolean | null | undefined }) {
  if (field.fieldType === "heading") {
    return <h2 className="font-display text-lg text-gold pt-4 border-t border-gold/15">{field.label}</h2>;
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
