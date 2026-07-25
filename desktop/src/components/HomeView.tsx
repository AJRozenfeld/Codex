import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp, type EntityType } from "../lib/store";
import { EntityCard, SectionHeading, truncate } from "./ui";
import { TYPE_META, cardsFor } from "./ListView";

// The Codex's opening page: a greeting, the freshest history, anything newly
// revealed since last time, and a search that spans the whole snapshot.
export default function HomeView() {
  const { content, campaign, player, newIds, navigate } = useApp();
  const [query, setQuery] = useState("");

  const searchable = useMemo(() => {
    if (!content) return [];
    const types: EntityType[] = ["characters", "regions", "locations", "factions", "storylines", "artifacts", "moons"];
    return types.flatMap((t) =>
      cardsFor(t, content).map((c) => ({ ...c, type: t }))
    );
  }, [content]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchable
      .filter((c) => c.title.toLowerCase().includes(q) || c.excerpt?.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q))
      .slice(0, 12);
  }, [searchable, query]);

  const fresh = useMemo(() => {
    if (!content || newIds.size === 0) return [];
    return searchable.filter((c) => newIds.has(`${c.type}:${c.id}`)).slice(0, 6);
  }, [content, newIds, searchable]);

  const latest = useMemo(() => {
    const events = [...(content?.timeline ?? [])].sort((a, b) => b.sortIndex - a.sortIndex);
    return events.slice(0, 3);
  }, [content]);

  const name = player?.displayName || player?.username || "traveler";

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <SectionHeading eyebrow={campaign?.name ?? "The Chronicle"} title={`Welcome back, ${name}`} />
      </motion.div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the whole Codex…"
        className="w-full max-w-md rounded bg-ink-raised/80 border border-gold/20 px-4 py-2.5 text-sm text-parchment placeholder:text-parchment/25 focus:border-gold/60 focus:shadow-glow outline-none transition-shadow"
      />

      {query.trim() ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {results.length === 0 && <p className="text-sm text-parchment/50">Nothing in the Codex matches that.</p>}
          {results.map((r, i) => (
            <EntityCard
              key={`${r.type}:${r.id}`}
              index={i}
              title={r.title}
              subtitle={`${TYPE_META[r.type].title} ${r.subtitle ? `· ${r.subtitle}` : ""}`}
              excerpt={r.excerpt}
              imageUrl={r.imageUrl}
              onClick={() => navigate({ name: "detail", type: r.type, id: r.id })}
            />
          ))}
        </div>
      ) : (
        <>
          {fresh.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-lg text-gold mb-1">Newly unveiled</h2>
              <p className="text-xs text-parchment/40 mb-4 italic">The DM has committed new truths to the record.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {fresh.map((r, i) => (
                  <EntityCard
                    key={`${r.type}:${r.id}`}
                    index={i}
                    title={r.title}
                    subtitle={TYPE_META[r.type].title}
                    excerpt={r.excerpt}
                    imageUrl={r.imageUrl}
                    isNew
                    onClick={() => navigate({ name: "detail", type: r.type, id: r.id })}
                  />
                ))}
              </div>
            </div>
          )}

          {latest.length > 0 && (
            <div className="mt-10">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg text-gold mb-4">Recent history</h2>
                <button onClick={() => navigate({ name: "timeline" })} className="text-xs text-parchment/50 hover:text-gold">
                  full chronicle &rarr;
                </button>
              </div>
              <div className="space-y-3">
                {latest.map((e) => (
                  <div key={e.id} className="card-surface rounded border border-gold/10 p-4">
                    <div className="text-xs text-ember/80 uppercase tracking-wider2">
                      {[e.inWorldDate, e.sessionNumber != null ? `Session ${e.sessionNumber}` : null].filter(Boolean).join(" · ")}
                    </div>
                    <div className="font-display text-gold mt-1">{e.title}</div>
                    <p className="text-sm text-parchment/60 mt-1">{truncate(e.description, 200)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
