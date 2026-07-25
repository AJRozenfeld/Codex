import { motion } from "framer-motion";
import { useApp } from "../lib/store";
import { EmptyState, NewBadge, SectionHeading } from "./ui";

// The campaign's history as a single illuminated thread - grouped by
// session, oldest first, exactly the order the table lived it.
export default function TimelineView() {
  const { content, newIds } = useApp();
  const events = [...(content?.timeline ?? [])].sort((a, b) => a.sortIndex - b.sortIndex);

  return (
    <div>
      <SectionHeading eyebrow="The Chronicle" title="Timeline" />
      {events.length === 0 ? (
        <EmptyState message="History has yet to be written." />
      ) : (
        <div className="relative pl-8">
          <div className="absolute left-2.5 top-1 bottom-1 w-px bg-gradient-to-b from-transparent via-gold/40 to-transparent" />
          <div className="space-y-6">
            {events.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.5), duration: 0.3 }}
                className="relative"
              >
                <span className="absolute -left-8 top-1.5 w-3 h-3 rotate-45 bg-ink border border-gold/70" />
                <div className="card-surface rounded border border-gold/10 p-4 shadow-card">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-ember/80 uppercase tracking-wider2">
                    {e.inWorldDate && <span>{e.inWorldDate}</span>}
                    {e.sessionNumber != null && <span>· Session {e.sessionNumber}</span>}
                    {e.eventType && <span>· {e.eventType}</span>}
                    {e.locationName && <span>· {e.locationName}</span>}
                    {newIds.has(`timeline:${e.id}`) && <NewBadge />}
                  </div>
                  <h3 className="font-display text-lg text-gold mt-1">{e.title}</h3>
                  <p className="prose-erendyl text-sm mt-2">{e.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
