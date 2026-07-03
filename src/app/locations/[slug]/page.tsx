import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocationBySlug, getChildLocations, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EntityCard } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function LocationDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const location = await getLocationBySlug(params.slug, viewer);
  if (!location) notFound();

  const children = await getChildLocations(location.id, viewer);
  const backlinks = await getBacklinksForEntity(location.id, viewer);

  return (
    <div>
      <div className="text-sm text-parchment/50 space-x-2">
        {location.regionSlug && (
          <Link href={`/regions/${location.regionSlug}`} className="hover:text-gold">
            {location.regionName}
          </Link>
        )}
        {location.parentSlug && (
          <>
            <span>/</span>
            <Link href={`/locations/${location.parentSlug}`} className="hover:text-gold">
              {location.parentName}
            </Link>
          </>
        )}
      </div>
      <div className="mt-4">
        <SectionHeading eyebrow={location.type} title={location.name} />
      </div>
      <div className="prose-erendyl mb-12 whitespace-pre-line">{location.description}</div>

      {children.length > 0 && (
        <section>
          <h2 className="font-display text-2xl text-gold mb-4">Within {location.name}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {children.map((c) => (
              <EntityCard key={c.id} href={`/locations/${c.slug}`} eyebrow={c.type} title={c.name} description={c.description} />
            ))}
          </div>
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
