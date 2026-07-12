import { notFound } from "next/navigation";
import Link from "next/link";
import { getStorylineBySlug, getStorylineCharacters, getBacklinksForEntity } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState, EntityCard } from "@/components/Card";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  Active: "bg-ember/30 border-ember/60",
  Dormant: "bg-gold/20 border-gold/40",
  Resolved: "bg-parchment/10 border-parchment/30",
  Background: "bg-void border-gold/20",
};

export default async function StorylineDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const storyline = await getStorylineBySlug(params.slug, viewer);
  if (!storyline) notFound();

  const characters = await getStorylineCharacters(storyline.id, viewer);
  const backlinks = await getBacklinksForEntity(storyline.id, viewer);

  return (
    <div>
      <Link href="/storylines" className="text-sm text-parchment/50 hover:text-gold">&larr; All storylines</Link>
      <div className="mt-4">
        <SectionHeading title={storyline.title}>
          <span
            className={`inline-block mt-3 rounded-full border px-3 py-1 text-xs ${statusColors[storyline.status] ?? "border-gold/30"}`}
          >
            {storyline.status}
          </span>
        </SectionHeading>
      </div>

      {storyline.locationName && (
        <div className="text-sm text-parchment/60 mb-6">
          Centered on{" "}
          <Link href={`/locations/${storyline.locationSlug}`} className="text-gold hover:underline">
            {storyline.locationName}
          </Link>
        </div>
      )}

      <p className="text-parchment/80 italic mb-6">{storyline.summary}</p>
      {storyline.description && (
        <div className="prose-erendyl mb-8 whitespace-pre-line">{storyline.description}</div>
      )}

      {storyline.nextStep && (
        <section className="card-static mb-8 rounded-lg border border-gold/20 shadow-card p-5">
          <h2 className="font-display text-lg text-gold mb-2">What's Next</h2>
          <p className="text-parchment/80 whitespace-pre-line">{storyline.nextStep}</p>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl text-gold mb-4">Involved Characters</h2>
        {characters.length === 0 ? (
          <EmptyState message="No involved characters have been revealed yet." />
        ) : (
          <ul className="flex flex-wrap gap-3">
            {characters.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/characters/${c.slug}`}
                  className="card-static block rounded-lg border border-gold/15 shadow-card px-4 py-2 hover:border-gold/50 transition-colors"
                >
                  <div className="text-parchment">{c.name}</div>
                  {c.role && <div className="text-xs text-parchment/50">{c.role}</div>}
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
