# The Erendyl Codex — Player Website

A standalone player-facing website for the Erendyl campaign, with its own
database, completely separate from the Codex desktop app. Every entry has
a `Revealed` toggle so nothing reaches players until you've actually
revealed it at the table.

**Public pages:** world lore, regions/kingdoms, locations, characters,
factions, storylines, artifacts, timeline, and search.

**Admin panel:** password-gated at `/admin` — add, edit, and reveal/hide
anything through plain forms. No file editing required.

## Quick start

```bash
npm install
npm run seed   # loads the starting content (moons, kingdoms, the party, etc.)
npm run dev    # http://localhost:3000
```

Default local admin password: `erendyl` (change it — see DEPLOYMENT.md).

## Getting this online for your players

See **DEPLOYMENT.md** for the full walkthrough: hosting the database on
Turso (free tier) and the site on Vercel (free tier), both taking about
10 minutes total.

## What's already seeded

Everything currently public in your vault's `07_Player_Handouts/` folder,
the five player-character bios, the factions your party has actually
encountered, the Wildheart Core, and the story of Sessions 1 through 6 —
all trimmed of DM-only secrets. Anything still developing at the table
(Old Camor, the Draconic Brotherhood, etc.) is seeded but left hidden;
flip it on from `/admin` whenever you're ready.
