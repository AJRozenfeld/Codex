import { useMemo } from "react";
import { assetUrl } from "../lib/api";
import { useApp, type EntityType } from "../lib/store";
import type { ContentSnapshot } from "../lib/types";
import { BackLink, EmptyState, EntityCard, MetaItem, Prose, SectionHeading, truncate } from "./ui";
import { TYPE_META } from "./ListView";

// Everything below navigates entirely inside the local snapshot - relations
// (a region's locations, a location's characters, an owner's artifacts...)
// are computed client-side, which is why moving around the Codex feels
// instant in a way a website never quite can.

function RelatedGrid({
  title,
  items,
}: {
  title: string;
  items: { id: string; type: EntityType; title: string; subtitle?: string | null; imageUrl?: string | null }[];
}) {
  const { navigate, newIds } = useApp();
  if (items.length === 0) return null;
  return (
    <div className="mt-10">
      <div className="ornate-divider mb-4">
        <span className="glyph" />
      </div>
      <h2 className="font-display text-lg text-gold mb-4">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it, i) => (
          <EntityCard
            key={`${it.type}:${it.id}`}
            index={i}
            title={it.title}
            subtitle={it.subtitle}
            imageUrl={it.imageUrl}
            isNew={newIds.has(`${it.type}:${it.id}`)}
            onClick={() => navigate({ name: "detail", type: it.type, id: it.id })}
          />
        ))}
      </div>
    </div>
  );
}

/** Maps an ArticleListItemSummary href ("/characters/foo") back onto a local
 *  entity so section records deep-link inside the app. */
function resolveHref(content: ContentSnapshot, href: string): { type: EntityType; id: string } | null {
  const m = href.match(/^\/(characters|regions|locations|factions|storylines|artifacts)\/([^/?#]+)/);
  if (!m) return null;
  const type = m[1] as EntityType;
  const slug = decodeURIComponent(m[2]);
  const list = content[type] as { id: string; slug: string }[];
  const hit = list.find((e) => e.slug === slug);
  return hit ? { type, id: hit.id } : null;
}

export default function DetailView({ type, id }: { type: EntityType; id: string }) {
  const { content, back, navigate } = useApp();

  const body = useMemo(() => {
    if (!content) return null;
    switch (type) {
      case "regions": {
        const r = content.regions.find((x) => x.id === id);
        if (!r) return null;
        const locations = content.locations.filter((l) => l.regionId === r.id && !l.parentId);
        const factions = content.factions.filter((f) => f.regionId === r.id);
        return (
          <>
            <SectionHeading eyebrow={r.type} title={r.name} />
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Capital" value={r.capital} />
              <MetaItem label="Government" value={r.government} />
              <MetaItem label="Faith" value={r.faith} />
              <MetaItem label="Patron Moon" value={r.moonName} />
            </dl>
            <Prose text={r.description} />
            <RelatedGrid
              title="Places within"
              items={locations.map((l) => ({ id: l.id, type: "locations" as const, title: l.name, subtitle: l.type, imageUrl: assetUrl(l.thumbnailPath) }))}
            />
            <RelatedGrid
              title="Powers here"
              items={factions.map((f) => ({ id: f.id, type: "factions" as const, title: f.name, subtitle: f.type }))}
            />
          </>
        );
      }
      case "locations": {
        const l = content.locations.find((x) => x.id === id);
        if (!l) return null;
        const children = content.locations.filter((c) => c.parentId === l.id);
        const residents = content.characters.filter((c) => c.locationId === l.id);
        const artifacts = content.artifacts.filter((a) => a.locationId === l.id);
        return (
          <>
            <SectionHeading eyebrow={l.type} title={l.name} />
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Region" value={l.regionName} />
              <MetaItem label="Within" value={l.parentName} />
            </dl>
            <Prose text={l.description} />
            {l.notes && (
              <div className="mt-6 card-surface rounded border border-gold/15 p-4 text-sm text-parchment/70">
                <Prose text={l.notes} />
              </div>
            )}
            <RelatedGrid
              title="Within its walls"
              items={children.map((c) => ({ id: c.id, type: "locations" as const, title: c.name, subtitle: c.type }))}
            />
            <RelatedGrid
              title="Known to dwell here"
              items={residents.map((c) => ({ id: c.id, type: "characters" as const, title: c.name, subtitle: c.race, imageUrl: assetUrl(c.portraitPath) }))}
            />
            <RelatedGrid
              title="Treasures kept here"
              items={artifacts.map((a) => ({ id: a.id, type: "artifacts" as const, title: a.name, subtitle: a.rarity, imageUrl: assetUrl(a.imagePath) }))}
            />
          </>
        );
      }
      case "characters": {
        const c = content.characters.find((x) => x.id === id);
        if (!c) return null;
        const possessions = content.artifacts.filter((a) => a.ownerCharacterId === c.id);
        const portrait = assetUrl(c.portraitPath);
        return (
          <>
            <div className="flex gap-6 items-start mb-2">
              {portrait && (
                <img
                  src={portrait}
                  alt={c.name}
                  className="w-28 h-28 rounded-full object-cover border-2 border-gold/40 shadow-glow flex-none"
                  draggable={false}
                />
              )}
              <div className="min-w-0 flex-1">
                <SectionHeading
                  eyebrow={[c.isPc ? "Player Character" : "Character", !c.isAlive ? "† Fallen" : null].filter(Boolean).join(" · ")}
                  title={c.name}
                />
              </div>
            </div>
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Race" value={c.race} />
              <MetaItem label="Class" value={c.charClass} />
              <MetaItem label="Status" value={c.status} />
              <MetaItem label="Last seen" value={c.locationName} />
            </dl>
            {c.summary && <p className="text-parchment/80 italic mb-6">{c.summary}</p>}
            <Prose text={c.bio} />
            <RelatedGrid
              title="In their keeping"
              items={possessions.map((a) => ({ id: a.id, type: "artifacts" as const, title: a.name, subtitle: a.rarity, imageUrl: assetUrl(a.imagePath) }))}
            />
          </>
        );
      }
      case "factions": {
        const f = content.factions.find((x) => x.id === id);
        if (!f) return null;
        return (
          <>
            <SectionHeading eyebrow={f.type} title={f.name} />
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Seat of power" value={f.regionName} />
            </dl>
            <Prose text={f.description} />
            {f.goals && (
              <div className="mt-8">
                <h2 className="font-display text-lg text-gold mb-2">Aims</h2>
                <Prose text={f.goals} />
              </div>
            )}
          </>
        );
      }
      case "storylines": {
        const s = content.storylines.find((x) => x.id === id);
        if (!s) return null;
        const events = content.timeline.filter((e) => e.storylineId === s.id);
        return (
          <>
            <SectionHeading eyebrow={[s.status, s.priority].filter(Boolean).join(" · ")} title={s.title} />
            {s.summary && <p className="text-parchment/80 italic mb-6">{s.summary}</p>}
            <Prose text={s.description} />
            {s.nextStep && (
              <div className="mt-6 card-surface rounded border border-ember/30 p-4">
                <div className="text-ember/90 uppercase text-xs tracking-wider2 mb-1">The trail leads on</div>
                <p className="text-sm text-parchment/80">{s.nextStep}</p>
              </div>
            )}
            {events.length > 0 && (
              <div className="mt-10">
                <h2 className="font-display text-lg text-gold mb-4">Moments along this thread</h2>
                <div className="space-y-3">
                  {events.map((e) => (
                    <div key={e.id} className="card-surface rounded border border-gold/10 p-4">
                      <div className="text-xs text-ember/80 uppercase tracking-wider2">
                        {[e.inWorldDate, e.sessionNumber != null ? `Session ${e.sessionNumber}` : null].filter(Boolean).join(" · ")}
                      </div>
                      <div className="font-display text-gold mt-1">{e.title}</div>
                      <p className="text-sm text-parchment/60 mt-1">{truncate(e.description, 220)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      }
      case "artifacts": {
        const a = content.artifacts.find((x) => x.id === id);
        if (!a) return null;
        const image = assetUrl(a.imagePath);
        const owner = a.ownerCharacterId ? content.characters.find((c) => c.id === a.ownerCharacterId) : null;
        return (
          <>
            <SectionHeading
              eyebrow={[a.type, a.rarity, a.attunement ? "requires attunement" : null].filter(Boolean).join(" · ")}
              title={a.name}
            />
            {image && (
              <img src={image} alt={a.name} className="max-h-64 rounded border border-gold/20 mb-6" draggable={false} />
            )}
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Keeper" value={a.ownerName} />
              <MetaItem label="Resting place" value={a.locationName} />
            </dl>
            <Prose text={a.description} />
            {a.mechanics && (
              <div className="mt-8 card-surface rounded border border-gold/20 p-4">
                <div className="text-gold/90 uppercase text-xs tracking-wider2 mb-2">Mechanics</div>
                <Prose text={a.mechanics} />
              </div>
            )}
            {owner && (
              <RelatedGrid
                title="Borne by"
                items={[{ id: owner.id, type: "characters" as const, title: owner.name, subtitle: owner.race, imageUrl: assetUrl(owner.portraitPath) }]}
              />
            )}
          </>
        );
      }
      case "moons": {
        const m = content.moons.find((x) => x.id === id);
        if (!m) return null;
        const domains = content.regions.filter((r) => r.moonId === m.id);
        return (
          <>
            <SectionHeading eyebrow={[m.isGoddess ? "Goddess" : "Moon", m.cycle].filter(Boolean).join(" · ")} title={m.name} />
            <dl className="grid sm:grid-cols-3 gap-4 mb-8">
              <MetaItem label="Domain" value={m.domain} />
            </dl>
            <Prose text={m.description} />
            <RelatedGrid
              title="Lands beneath this light"
              items={domains.map((r) => ({ id: r.id, type: "regions" as const, title: r.name, subtitle: r.type }))}
            />
          </>
        );
      }
      case "sections": {
        const s = content.sections.find((x) => x.id === id);
        if (!s) return null;
        return (
          <>
            <SectionHeading eyebrow="Chronicle" title={s.name} />
            {s.lists.length === 0 && <EmptyState message="This chronicle's pages are still blank." />}
            <div className="space-y-10">
              {s.lists.map((list) => (
                <div key={list.id}>
                  <h2 className="font-display text-lg text-gold mb-4">{list.name}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.items.map((item, i) => {
                      const target = resolveHref(content, item.href);
                      return (
                        <EntityCard
                          key={item.entityId}
                          index={i}
                          title={item.title}
                          subtitle={item.subtitle}
                          excerpt={truncate(item.description)}
                          imageUrl={assetUrl(item.imagePath)}
                          onClick={() => target && navigate({ name: "detail", type: target.type, id: target.id })}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      }
    }
  }, [content, type, id, navigate]);

  return (
    <div>
      <div className="mb-4">
        <BackLink label={TYPE_META[type].title} onClick={back} />
      </div>
      {body ?? <EmptyState message="This page of the Codex is missing - it may have been re-veiled by the DM." />}
    </div>
  );
}
