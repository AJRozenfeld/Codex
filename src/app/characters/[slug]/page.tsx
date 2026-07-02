import { notFound } from "next/navigation";
import Link from "next/link";
import { getCharacterBySlug, getCharacterFactions } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading } from "@/components/Card";

export const dynamic = "force-dynamic";

export default async function CharacterDetailPage({ params }: { params: { slug: string } }) {
  const viewer = await getViewerContext();
  const character = await getCharacterBySlug(params.slug, viewer);
  if (!character) notFound();

  const factions = await getCharacterFactions(character.id, viewer);

  return (
    <div>
      <Link href="/characters" className="text-sm text-parchment/50 hover:text-gold">&larr; All characters</Link>
      <div className="mt-4 flex items-start gap-5">
        {character.portraitPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.portraitPath}
            alt={character.name}
            className="h-24 w-24 sm:h-32 sm:w-32 rounded-lg object-cover border border-gold/20 flex-shrink-0"
          />
        )}
        <SectionHeading
          eyebrow={[character.isPc ? "Player Character" : "NPC", character.race, character.charClass].filter(Boolean).join(" · ")}
          title={character.name}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-6 text-xs">
        {!character.isAlive && (
          <span className="rounded-full bg-blood/30 border border-blood/50 px-3 py-1 text-parchment/80">Deceased</span>
        )}
        {character.status && (
          <span className="rounded-full border border-gold/30 px-3 py-1 text-parchment/70">{character.status}</span>
        )}
        {character.locationName && (
          <Link href={`/locations/${character.locationSlug}`} className="rounded-full border border-gold/30 px-3 py-1 text-parchment/70 hover:text-gold">
            {character.locationName}
          </Link>
        )}
      </div>

      <p className="text-parchment/80 italic mb-6">{character.summary}</p>
      <div className="prose-erendyl mb-12 whitespace-pre-line">{character.bio}</div>

      {factions.length > 0 && (
        <section>
          <h2 className="font-display text-2xl text-gold mb-4">Affiliations</h2>
          <ul className="flex flex-wrap gap-3">
            {factions.map(({ faction, role }) => (
              <li key={faction.id}>
                <Link
                  href={`/factions/${faction.slug}`}
                  className="block rounded-lg border border-gold/15 bg-void/60 px-4 py-2 hover:border-gold/50 transition-colors"
                >
                  <div className="text-parchment">{faction.name}</div>
                  {role && <div className="text-xs text-parchment/50">{role}</div>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
