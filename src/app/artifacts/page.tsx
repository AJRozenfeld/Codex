import { getArtifacts } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function ArtifactsPage() {
  const viewer = await getViewerContext();
  const artifacts = await getArtifacts(viewer);
  return (
    <div>
      <SectionHeading eyebrow="Relics & Wonders" title="Artifacts" />
      {artifacts.length === 0 ? (
        <EmptyState message="No artifacts have been revealed yet." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {artifacts.map((a) => (
            <EntityCard
              key={a.id}
              href={`/artifacts/${a.slug}`}
              eyebrow={[a.type, a.rarity].filter(Boolean).join(" · ")}
              title={a.name}
              subtitle={a.ownerName ? `Held by ${a.ownerName}` : a.locationName ?? undefined}
              description={a.description}
            />
          ))}
        </div>
      )}
    </div>
  );
}
