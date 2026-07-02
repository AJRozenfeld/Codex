import { getRegions } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function RegionsPage() {
  const viewer = await getViewerContext();
  const regions = await getRegions(viewer);
  return (
    <div>
      <SectionHeading eyebrow="The World" title="Regions & Kingdoms" />
      {regions.length === 0 ? (
        <EmptyState message="No regions have been revealed yet." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {regions.map((r) => (
            <EntityCard
              key={r.id}
              href={`/regions/${r.slug}`}
              eyebrow={r.type}
              title={r.name}
              subtitle={r.capital ? `Capital: ${r.capital}` : undefined}
              description={r.description}
            />
          ))}
        </div>
      )}
    </div>
  );
}
