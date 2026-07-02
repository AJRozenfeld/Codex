import Link from "next/link";
import { search } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

const typeHref: Record<string, string> = {
  Character: "characters",
  Location: "locations",
  Faction: "factions",
  Storyline: "storylines",
  Artifact: "artifacts",
  Region: "regions",
};

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q ?? "";
  const viewer = await getViewerContext();
  const results = q ? await search(q, viewer) : [];

  return (
    <div>
      <SectionHeading eyebrow="Seek and find" title={q ? `Results for "${q}"` : "Search the Codex"} />
      {!q ? (
        <EmptyState message="Type something into the search bar above to begin." />
      ) : results.length === 0 ? (
        <EmptyState message="Nothing revealed yet matches your search." />
      ) : (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={`${r.type}-${r.id}`}>
              <Link
                href={`/${typeHref[r.type]}/${r.slug}`}
                className="block rounded-lg border border-gold/15 bg-void/60 p-4 hover:border-gold/50 transition-colors"
              >
                <div className="text-xs uppercase tracking-widest text-ember/80 mb-1">{r.type}</div>
                <div className="font-display text-lg text-parchment">{r.title}</div>
                <p className="text-sm text-parchment/60 mt-1 line-clamp-2">{r.snippet}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
