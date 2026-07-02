import { getFactions } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function FactionsPage() {
  const viewer = await getViewerContext();
  const factions = await getFactions(viewer);
  return (
    <div>
      <SectionHeading eyebrow="Powers at Play" title="Factions" />
      {factions.length === 0 ? (
        <EmptyState message="No factions have been revealed yet." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {factions.map((f) => (
            <EntityCard
              key={f.id}
              href={`/factions/${f.slug}`}
              eyebrow={f.type}
              title={f.name}
              subtitle={f.regionName ?? undefined}
              description={f.description}
            />
          ))}
        </div>
      )}
    </div>
  );
}
