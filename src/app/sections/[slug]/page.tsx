import { notFound } from "next/navigation";
import { getSectionBySlug } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function SectionPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const section = await getSectionBySlug(params.slug, viewer);
  if (!section) notFound();

  return (
    <div className="space-y-12">
      <SectionHeading title={section.name} />

      {section.lists.length === 0 && <EmptyState message="Nothing has been added to this section yet." />}

      {section.lists.map((list) => (
        <section key={list.id}>
          <h2 className="font-display text-2xl text-gold mb-4">{list.name}</h2>
          {list.items.length === 0 ? (
            <EmptyState message="Nothing has been revealed here yet." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.items.map((item) => (
                <EntityCard
                  key={item.entityId}
                  href={item.href}
                  title={item.title}
                  subtitle={item.subtitle}
                  description={item.description}
                  imageUrl={item.imagePath}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
