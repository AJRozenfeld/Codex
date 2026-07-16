# Deploying the Erendyl Codex

This app is a standalone Next.js site with its own SQLite-compatible database
(via `@libsql/client`). It does not depend on the Codex desktop app in any
way — everything here is self-contained.

## 1. Local development

```bash
npm install
npm run seed   # populates db/dev.db with the starting content
npm run dev    # http://localhost:3000
```

The dev database is a plain file at `db/dev.db`. Delete it and re-run
`npm run seed` any time you want a clean slate.

Set an admin password for local testing by creating `.env.local`:

```
ADMIN_PASSWORD=whatever-you-want
SESSION_SECRET=a-random-string-at-least-32-characters-long
```

If you skip this, the local default password is `erendyl` — fine for
testing, not for anything public.

## 2. Hosting the database (Turso)

The site needs a real hosted database once it's live so it isn't tied to
one machine's disk. [Turso](https://turso.tech) is a hosted, serverless
SQLite service (built on libSQL, the same engine this app already uses
locally) with a generous free tier.

1. Create a free Turso account and install their CLI (`turso auth login`
   after installing).
2. Create a database: `turso db create erendyl-codex`
3. Get the connection URL: `turso db show erendyl-codex --url`
4. Get an auth token: `turso db tokens create erendyl-codex`
5. Note both values — you'll paste them into Vercel's environment
   variables in step 3 below.
6. Point the schema + seed at the new database once, from your machine:

   ```bash
   DATABASE_URL="libsql://<your-db-url>" DATABASE_AUTH_TOKEN="<your-token>" npm run seed
   ```

## 3. Hosting the site (Vercel)

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com), sign in, and import the
   repository as a new project. Vercel auto-detects Next.js — no
   configuration needed.
3. Before the first deploy, add these environment variables in the
   Vercel project settings (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the `libsql://...` URL from Turso |
   | `DATABASE_AUTH_TOKEN` | the token from Turso |
   | `ADMIN_PASSWORD` | the real password you want to use to manage content |
   | `SESSION_SECRET` | any random string, 32+ characters |
   | `BLOB_READ_WRITE_TOKEN` | from the Vercel Blob store, see below |

4. Set up map image storage: in the Vercel project, go to Storage → Create
   Database → Blob, create a store, and connect it to this project. Vercel
   fills in `BLOB_READ_WRITE_TOKEN` for you automatically once connected —
   no manual copy/paste needed. Without this token, map image uploads still
   work locally (saved to `public/uploads/maps`) but won't persist on
   Vercel's read-only filesystem, so this step is required before uploading
   maps in production.
5. Deploy. Vercel gives you a `*.vercel.app` URL immediately; you can
   attach a custom domain afterward in the same project's Domains tab.

## 4. Day-to-day content editing

Once deployed, go to `yoursite.com/admin`, log in with `ADMIN_PASSWORD`,
and use the forms there to add, edit, or hide anything. The `Revealed`
checkbox on every entry controls whether players can see it — leave new
entries unchecked until you're ready to reveal them at the table.

Changes save straight to the hosted database — no redeploy needed for
content changes, only for code changes.

## 5. Updating the code later

If you (or Claude, in a future session) want to change how the site looks
or add new features, edit the code and push to GitHub — Vercel redeploys
automatically on every push to your main branch.

## License system (closed beta)

The site is multi-tenant: `/master` is the license-issuer console, gated by
its own password. Set **`MASTER_PASSWORD`** in the Vercel project's
environment variables (falls back to a dev-only default locally - never
leave that in production).

Flow: create a license in `/master` (name + quotas) -> share the one-time
claim link -> the DM sets username+password there and gets a blank campaign
-> the DM shares their `/join/<slug>` link with players, who self-register
and then get assigned to a campaign from `/admin/players`.

The founder account (all pre-license data) still logs into `/admin/login`
by leaving the username blank and entering `ADMIN_PASSWORD`.
