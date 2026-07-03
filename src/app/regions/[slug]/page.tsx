import { notFound } from "next/navigation";
import Link from "next/link";
import { getRegionBySlug, getLocations, getFactions, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EntityCard, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function RegionDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const region = await getRegionBySlug(params.slug, viewer);
  if (!region) notFound();

  const [allLocations, allFactions] = await Promise.all([getLocations(viewer), getFactions(viewer)]);
  const locations = allLocations.filter((l) => l.regionId === region.id && !l.parentId);
  const factions = allFactions.filter((f) => f.regionId === region.id);
  const backlinks = await getBacklinksForEntity(region.id, viewer);

  return (
    <div>
      <Link href="/regions" className="text-sm text-parchment/50 hover:text-gold">&larr; All regions</Link>
      <div className="mt-4">
        <SectionHeading eyebrow={region.type} title={region.name} />
      </div>
      <dl className="grid sm:grid-cols-3 gap-4 mb-8 text-sm">
        {region.capital && (
          <div>
            <dt className="text-ember/80 uppercase text-xs tracking-widest">Capital</dt>
            <dd className="text-parchment mt-1">{region.capital}</dd>
          </div>
        )}
        {region.government && (
          <div>
            <dt className="text-ember/80 uppercase text-xs tracking-widest">Government</dt>
            <dd className="text-parchment mt-1">{region.government}</dd>
          </div>
        )}
        {region.faith && (
          <div>
            <dt className="text-ember/80 uppercase text-xs tracking-widest">Faith</dt>
            <dd className="text-parchment mt-1">{region.faith}</dd>
          </div>
        )}
        {region.moonName && (
          <div>
            <dt className="text-ember/80 uppercase text-xs tracking-widest">Patron Moon</dt>
            <dd className="text-parchment mt-1">{region.moonName}</dd>
          </div>
        )}
      </dl>
      <div className="prose-erendyl mb-12 whitespace-pre-line">{region.description}</div>

      {locations.length > 0 && (
        <section className="mb-12">
          <h2 className="font-display text-2xl text-gold mb-4">Notable Locations</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((l) => (
              <EntityCard key={l.id} href={`/locations/${l.slug}`} eyebrow={l.type} title={l.name} description={l.description} />
            ))}
          </div>
        </section>
      )}

      {factions.length > 0 && (
        <section>
          <h2 className="font-display text-2xl text-gold mb-4">Factions</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {factions.map((f) => (
              <EntityCard key={f.id} href={`/factions/${f.slug}`} eyebrow={f.type} title={f.name} description={f.description} />
            ))}
          </div>
        </section>
      )}

      {locations.length === 0 && factions.length === 0 && (
        <EmptyState message="No further details have been revealed for this region yet." />
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
