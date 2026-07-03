"use client";

import { useState } from "react";
import Link from "next/link";
import type { CharacterMapToken } from "@/lib/types";

// Sidebar shown alongside (never inside) MapExplorer - see MapEntity.tokens
// in queries.ts. Deliberately a separate component so it can never clip or
// override the map's own pan/zoom surface. Lists every character whose
// token currently resolves onto the given map; clicking a name opens a
// small bio popover with a link to the full character page.
export function MapCharacterList({ tokens, mapName }: { tokens: CharacterMapToken[]; mapName?: string }) {
  const [active, setActive] = useState<CharacterMapToken | null>(null);

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-gold/15 bg-ink/40 p-4">
        <h3 className="font-display text-sm text-gold mb-1">Present Here</h3>
        <p className="text-xs text-parchment/40">No known characters are currently placed on this map.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gold/15 bg-ink/40 p-4">
      <h3 className="font-display text-sm text-gold mb-3">
        Present Here{mapName ? <span className="text-parchment/40 font-normal"> &middot; {mapName}</span> : null}
      </h3>
      <ul className="space-y-2">
        {tokens.map((token) => (
          <li key={token.characterId}>
            <button
              type="button"
              onClick={() => setActive(token)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gold/10 transition-colors"
            >
              {token.portraitPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={token.portraitPath}
                  alt={token.name}
                  className="h-8 w-8 rounded-full object-cover border border-gold/30"
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-void border border-gold/30 text-[10px] text-parchment">
                  {token.name.slice(0, 1)}
                </span>
              )}
              <span className="text-sm text-parchment/80">{token.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-gold/30 bg-ink p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              {active.portraitPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={active.portraitPath}
                  alt={active.name}
                  className="h-14 w-14 rounded-full object-cover border-2 border-gold/40"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-void border-2 border-gold/40 text-lg text-parchment">
                  {active.name.slice(0, 1)}
                </span>
              )}
              <h3 className="font-display text-lg text-gold">{active.name}</h3>
            </div>
            {active.summary && <p className="mt-3 text-sm text-parchment/70">{active.summary}</p>}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-xs text-parchment/50 hover:text-parchment"
              >
                Close
              </button>
              <Link
                href={`/characters/${active.slug}`}
                className="rounded-full bg-gold/90 text-ink px-3 py-1 text-xs font-medium hover:bg-gold"
              >
                View Character
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
