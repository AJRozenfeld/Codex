import { getCharacters } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { EntityCard, SectionHeading, EmptyState } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const viewer = await getViewerContext();
  const characters = await getCharacters(viewer);
  const pcs = characters.filter((c) => c.isPc);
  const npcs = characters.filter((c) => !c.isPc);

  return (
    <div className="space-y-12">
      <div>
        <SectionHeading eyebrow="The Table" title="Characters" />
      </div>

      <section>
        <h2 className="font-display text-2xl text-gold mb-4">Player Characters</h2>
        {pcs.length === 0 ? (
          <EmptyState message="No player characters have been revealed yet." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pcs.map((c) => (
              <EntityCard
                key={c.id}
                href={`/characters/${c.slug}`}
                eyebrow={[c.race, c.charClass].filter(Boolean).join(" · ") || undefined}
                title={c.name}
                subtitle={!c.isAlive ? "Deceased" : undefined}
                description={c.summary}
                imageUrl={c.portraitPath}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl text-gold mb-4">NPCs</h2>
        {npcs.length === 0 ? (
          <EmptyState message="No NPCs have been revealed yet." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {npcs.map((c) => (
              <EntityCard
                key={c.id}
                href={`/characters/${c.slug}`}
                eyebrow={[c.race, c.charClass].filter(Boolean).join(" · ") || undefined}
                title={c.name}
                subtitle={!c.isAlive ? "Deceased" : c.locationName ?? undefined}
                description={c.summary}
                imageUrl={c.portraitPath}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
