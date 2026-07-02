import Link from "next/link";
import { getTimelineEvents } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  const viewer = await getViewerContext();
  const events = await getTimelineEvents(viewer);

  return (
    <div>
      <SectionHeading eyebrow="The Chronicle" title="Timeline" />
      {events.length === 0 ? (
        <EmptyState message="No events have been revealed yet." />
      ) : (
        <ol className="relative border-l border-gold/20 pl-6 space-y-8">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full bg-gold" />
              <div className="text-xs uppercase tracking-widest text-ember/80">
                {e.inWorldDate ?? "Undated"} {e.sessionNumber ? `· Session ${e.sessionNumber}` : ""} · {e.eventType}
              </div>
              <h3 className="font-display text-xl text-parchment mt-1">{e.title}</h3>
              <p className="text-sm text-parchment/70 mt-2 whitespace-pre-line">{e.description}</p>
              {e.locationName && (
                <Link href={`/locations/${e.locationSlug}`} className="inline-block mt-2 text-xs text-gold hover:underline">
                  {e.locationName}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
