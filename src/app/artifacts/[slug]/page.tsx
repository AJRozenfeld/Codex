import { notFound } from "next/navigation";
import Link from "next/link";
import { getArtifactBySlug, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EntityCard } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function ArtifactDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const artifact = await getArtifactBySlug(params.slug, viewer);
  if (!artifact) notFound();

  const backlinks = await getBacklinksForEntity(artifact.id, viewer);

  return (
    <div>
      <Link href="/artifacts" className="text-sm text-parchment/50 hover:text-gold">&larr; All artifacts</Link>
      <div className="mt-4">
        <SectionHeading eyebrow={[artifact.type, artifact.rarity].filter(Boolean).join(" · ")} title={artifact.name} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6 text-xs">
        {artifact.attunement && (
          <span className="rounded-full border border-gold/40 px-3 py-1 text-parchment/70">Requires Attunement</span>
        )}
        {artifact.ownerName && (
          <Link href={`/characters/${artifact.ownerSlug}`} className="rounded-full border border-gold/30 px-3 py-1 text-parchment/70 hover:text-gold">
            Held by {artifact.ownerName}
          </Link>
        )}
        {artifact.locationName && (
          <Link href={`/locations/${artifact.locationSlug}`} className="rounded-full border border-gold/30 px-3 py-1 text-parchment/70 hover:text-gold">
            {artifact.locationName}
          </Link>
        )}
      </div>

      <div className="prose-erendyl mb-8 whitespace-pre-line">{artifact.description}</div>

      {artifact.mechanics && (
        <section className="card-static rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-2">Mechanics</h2>
          <p className="text-parchment/80 whitespace-pre-line">{artifact.mechanics}</p>
        </section>
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
