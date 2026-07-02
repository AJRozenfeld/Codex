import { getStorylines } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function StorylinesPage() {
  const viewer = await getViewerContext();
  const storylines = await getStorylines(viewer);
  return (
    <div>
      <SectionHeading eyebrow="Threads of Fate" title="Storylines" />
      {storylines.length === 0 ? (
        <EmptyState message="No storylines have been revealed yet." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {storylines.map((s) => (
            <EntityCard
              key={s.id}
              href={`/storylines/${s.slug}`}
              eyebrow={s.status}
              title={s.title}
              subtitle={s.locationName ?? undefined}
              description={s.summary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
