import { notFound } from "next/navigation";
import Link from "next/link";
import { getFactionBySlug, getFactionMembers, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState, EntityCard } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function FactionDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const faction = await getFactionBySlug(params.slug, viewer);
  if (!faction) notFound();

  const members = await getFactionMembers(faction.id, viewer);
  const backlinks = await getBacklinksForEntity(faction.id, viewer);

  return (
    <div>
      <Link href="/factions" className="text-sm text-parchment/50 hover:text-gold">&larr; All factions</Link>
      <div className="mt-4">
        <SectionHeading eyebrow={faction.type} title={faction.name} />
      </div>

      {faction.regionName && (
        <div className="text-sm text-parchment/60 mb-6">
          Based in{" "}
          <Link href={`/regions/${faction.regionSlug}`} className="text-gold hover:underline">
            {faction.regionName}
          </Link>
        </div>
      )}

      <div className="prose-erendyl mb-8 whitespace-pre-line">{faction.description}</div>

      {faction.goals && (
        <section className="mb-8">
          <h2 className="font-display text-xl text-gold mb-3">Goals</h2>
          <p className="text-parchment/80 whitespace-pre-line">{faction.goals}</p>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl text-gold mb-4">Known Members</h2>
        {members.length === 0 ? (
          <EmptyState message="No known members have been revealed yet." />
        ) : (
          <ul className="flex flex-wrap gap-3">
            {members.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/characters/${m.slug}`}
                  className="block rounded-lg border border-gold/15 bg-void/60 px-4 py-2 hover:border-gold/50 transition-colors"
                >
                  <div className="text-parchment">{m.name}</div>
                  {m.role && <div className="text-xs text-parchment/50">{m.role}</div>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

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
