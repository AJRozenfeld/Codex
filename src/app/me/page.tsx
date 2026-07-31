import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { SectionHeading } from "@/components/Card";

export const dynamic = "force-dynamic";

async function logoutAction() {
  "use server";
  const session = await getPlayerSession();
  session.destroy();
  redirect("/");
}

export default async function MyCharacterPage() {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  await ensureSchema();
  const r = await getDb().execute({
    sql: `SELECT p.display_name, c.id AS character_id, c.name AS character_name, c.slug AS character_slug
          FROM players p LEFT JOIN characters c ON c.id = p.character_id
          WHERE p.id = ?`,
    args: [session.playerId],
  });
  const row = r.rows[0];
  if (!row) redirect("/login");

  return (
    <div>
      <SectionHeading eyebrow="Welcome back" title={row.display_name as string} />
      {row.character_id ? (
        <div className="card-static rounded-lg border border-gold/15 shadow-card p-6">
          <p className="text-parchment/70 mb-4">
            You are playing <span className="text-gold">{row.character_name as string}</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/characters/${row.character_slug}`}
              className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm hover:bg-gold/10"
            >
              View Codex Entry
            </Link>
            <Link
              href="/me/sheet"
              className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold"
            >
              Open Character Sheet
            </Link>
            <Link
              href="/me/journal"
              className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm hover:bg-gold/10"
            >
              Open Journal
            </Link>
            <Link
              href="/me/profile"
              className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm hover:bg-gold/10"
            >
              Edit Bio &amp; Portrait
            </Link>
          </div>
        </div>
      ) : (
        <div className="card-static rounded-lg border border-gold/15 shadow-card p-6">
          <p className="text-parchment/70 mb-4">
            You don&apos;t have a character yet. If your DM has opened character creation, you can forge one
            now - otherwise, ask them to link one from the admin panel.
          </p>
          <Link
            href="/me/create"
            className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold"
          >
            Create Your Character
          </Link>
        </div>
      )}
      <div className="mt-6">
        <Link
          href="/me/password"
          className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm hover:bg-gold/10"
        >
          Change Password
        </Link>
      </div>
      <form action={logoutAction} className="mt-8">
        <button type="submit" className="text-sm text-parchment/50 hover:text-blood">Log out</button>
      </form>
    </div>
  );
}
