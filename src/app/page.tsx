import Link from "next/link";
import { getMoons, getStorylines, getTimelineEvents } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await getViewerContext();
  const [moons, storylines, events] = await Promise.all([
    getMoons(viewer),
    getStorylines(viewer),
    getTimelineEvents(viewer),
  ]);

  const activeStorylines = storylines.filter((s) => s.status === "Active").slice(0, 3);
  const recentEvents = events.slice(-5).reverse();

  return (
    <div className="space-y-20">
      <section className="relative text-center py-14 sm:py-20 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(201,168,76,0.10), transparent 70%)",
          }}
        />
        <div className="text-xs uppercase tracking-[0.35em] text-ember mb-4 animate-fade-in">
          Welcome, traveler
        </div>
        <h1 className="font-display text-5xl sm:text-6xl text-gold text-glow mb-5 animate-fade-in">
          The Erendyl Codex
        </h1>
        <div className="ornate-divider max-w-xs mx-auto mb-6">
          <span className="glyph" />
        </div>
        <p className="max-w-2xl mx-auto text-parchment/70 font-body italic text-lg leading-relaxed">
          A living chronicle of the world of Erendyl &mdash; its kingdoms, its people, its
          artifacts, and the threads of fate your table has already begun to pull.
        </p>
        <div className="flex justify-center gap-3 mt-10 flex-wrap">
          <Link
            href="/regions"
            className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-gold hover:shadow-glow transition-all"
          >
            Explore the world
          </Link>
          <Link
            href="/timeline"
            className="rounded-full border border-gold/40 text-gold px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-gold/10 hover:border-gold/70 transition-colors"
          >
            View the timeline
          </Link>
        </div>
      </section>

      {moons.length > 0 && (
        <section>
          <SectionHeading eyebrow="The Heavens" title="The Moons of Erendyl" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {moons.map((m) => (
              <div
                key={m.id}
                className="card-surface rounded-lg border border-gold/15 p-5 shadow-card"
              >
                <div className="text-xs uppercase tracking-widest text-ember/80 mb-1">
                  {m.isGoddess ? "Goddess" : "Moon"} &middot; {m.domain}
                </div>
                <h3 className="font-display text-lg text-parchment">{m.name}</h3>
                <p className="text-sm text-parchment/70 mt-2 line-clamp-3">{m.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading eyebrow="What's unfolding" title="Active Storylines" />
        {activeStorylines.length === 0 ? (
          <EmptyState message="No active storylines have been revealed yet." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeStorylines.map((s) => (
              <EntityCard
                key={s.id}
                href={`/storylines/${s.slug}`}
                eyebrow={s.status}
                title={s.title}
                subtitle={s.locationName}
                description={s.summary}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading eyebrow="History in the making" title="Recent Events" />
        {recentEvents.length === 0 ? (
          <EmptyState message="No events have been revealed yet." />
        ) : (
          <ul className="space-y-3">
            {recentEvents.map((e) => (
              <li
                key={e.id}
                className="card-surface rounded-lg border border-gold/10 p-4"
              >
                <div className="text-xs uppercase tracking-widest text-ember/70">
                  {e.inWorldDate ?? "Undated"} {e.sessionNumber ? `· Session ${e.sessionNumber}` : ""}
                </div>
                <h4 className="font-display text-parchment mt-1">{e.title}</h4>
                <p className="text-sm text-parchment/60 mt-1 line-clamp-2">{e.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
