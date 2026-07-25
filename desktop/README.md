# Erendyl Codex — Companion App

The desktop companion to the Codex: the same chronicle your players browse on
the website, wrapped in a native window with local caching (instant loads,
offline reading), animated page transitions, a play-ready character sheet
with the Discord roll bridge, and a "newly unveiled" spotlight whenever the
DM reveals new lore.

Built with Tauri 2 + React + Vite + Tailwind + Framer Motion. It talks to the
Codex website's JSON API (`/api/v1`), which authenticates with per-player
bearer tokens — the website and the app share one database, one `revealed`
flag, one truth.

## Getting the installer (no Rust needed)

The GitHub Action in `.github/workflows/desktop.yml` builds the Windows
installer. Push a change under `desktop/` (or run the **desktop-app** workflow
manually from the repo's Actions tab), then download
`erendyl-codex-windows-installer` from the run's artifacts. That `.exe` is
what you hand to players.

## Local development

Requires Node 20+ and the [Rust toolchain](https://rustup.rs) (plus the
Microsoft C++ Build Tools on Windows — the Tauri docs cover setup).

```bash
cd desktop
npm install
npm run tauri dev     # native window against your dev/prod server
```

Frontend-only iteration works in a plain browser too:

```bash
npm run dev           # http://localhost:1420 — window controls hide themselves
```

## Server

The login screen defaults to the production Codex
(`https://codex-erendyl.vercel.app`, see `DEFAULT_SERVER` in `src/lib/api.ts`);
"advanced: choose server" lets you point it anywhere — e.g.
`http://localhost:3000` against a local website checkout. Players can paste
their DM's `/login/<slug>` link straight into the Table field.

## Security note

The app's cache only ever contains what the API returned, and the API runs
every read through the website's own viewer-scoped query layer — unrevealed
content never reaches the client, so nothing secret can sit in a player's
localStorage. Keep it that way: any new endpoint must build its ViewerContext
from the bearer token and reuse `src/lib/queries.ts` on the server.
