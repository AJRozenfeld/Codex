import { useMemo, useState } from "react";
import { assetUrl } from "../lib/api";
import { useApp, type EntityType } from "../lib/store";
import type { ContentSnapshot } from "../lib/types";
import { EmptyState, EntityCard, SectionHeading, truncate } from "./ui";

export const TYPE_META: Record<EntityType, { title: string; eyebrow: string; empty: string }> = {
  characters: { title: "Characters", eyebrow: "Dramatis Personae", empty: "No souls have stepped into the light yet." },
  regions: { title: "Regions", eyebrow: "The Known World", empty: "The map is still dark." },
  locations: { title: "Locations", eyebrow: "Places of Note", empty: "No places of note… yet." },
  factions: { title: "Factions", eyebrow: "Powers & Orders", empty: "No banners have been raised." },
  storylines: { title: "Storylines", eyebrow: "Threads of Fate", empty: "The threads have yet to be spun." },
  artifacts: { title: "Artifacts", eyebrow: "Relics & Treasures", empty: "The vaults stand empty." },
  moons: { title: "The Nine Moons", eyebrow: "Cosmology", empty: "The night sky keeps its secrets." },
  sections: { title: "Lore", eyebrow: "Chronicles & Records", empty: "No chronicles have been penned." },
};

interface CardData {
  id: string;
  title: string;
  subtitle?: string | null;
  excerpt?: string | null;
  imageUrl?: string | null;
}

export function cardsFor(type: EntityType, content: ContentSnapshot): CardData[] {
  switch (type) {
    case "characters":
      return content.characters.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: [c.race, c.charClass, !c.isAlive ? "† fallen" : null].filter(Boolean).join(" · ") || c.status,
        excerpt: truncate(c.summary),
        imageUrl: assetUrl(c.portraitPath),
      }));
    case "regions":
      return content.regions.map((r) => ({
        id: r.id,
        title: r.name,
        subtitle: [r.type, r.moonName ? `under ${r.moonName}` : null].filter(Boolean).join(" · "),
        excerpt: truncate(r.description),
      }));
    case "locations":
      return content.locations.map((l) => ({
        id: l.id,
        title: l.name,
        subtitle: [l.type, l.regionName].filter(Boolean).join(" · "),
        excerpt: truncate(l.description),
        imageUrl: assetUrl(l.thumbnailPath),
      }));
    case "factions":
      return content.factions.map((f) => ({
        id: f.id,
        title: f.name,
        subtitle: [f.type, f.regionName].filter(Boolean).join(" · "),
        excerpt: truncate(f.description),
      }));
    case "storylines":
      return content.storylines.map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: [s.status, s.priority].filter(Boolean).join(" · "),
        excerpt: truncate(s.summary),
      }));
    case "artifacts":
      return content.artifacts.map((a) => ({
        id: a.id,
        title: a.name,
        subtitle: [a.type, a.rarity, a.attunement ? "attunement" : null].filter(Boolean).join(" · "),
        excerpt: truncate(a.description),
        imageUrl: assetUrl(a.imagePath),
      }));
    case "moons":
      return content.moons.map((m) => ({
        id: m.id,
        title: m.name,
        subtitle: [m.domain, m.cycle].filter(Boolean).join(" · "),
        excerpt: truncate(m.description),
      }));
    case "sections":
      return content.sections.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.lists.length} ${s.lists.length === 1 ? "record" : "records"}`,
      }));
  }
}

export default function ListView({ type }: { type: EntityType }) {
  const { content, newIds, navigate } = useApp();
  const [query, setQuery] = useState("");
  const meta = TYPE_META[type];

  const cards = useMemo(() => {
    if (!content) return [];
    const all = cardsFor(type, content);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.subtitle?.toLowerCase().includes(q) ||
        c.excerpt?.toLowerCase().includes(q)
    );
  }, [content, type, query]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <SectionHeading eyebrow={meta.eyebrow} title={meta.title} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mb-6 w-56 rounded bg-ink-raised/80 border border-gold/20 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/25 focus:border-gold/60 outline-none"
        />
      </div>
      {cards.length === 0 ? (
        <EmptyState message={query ? "Nothing in the Codex matches that." : meta.empty} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c, i) => (
            <EntityCard
              key={c.id}
              index={i}
              title={c.title}
              subtitle={c.subtitle}
              excerpt={c.excerpt}
              imageUrl={c.imageUrl}
              isNew={newIds.has(`${type}:${c.id}`)}
              onClick={() => navigate({ name: "detail", type, id: c.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
