import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession, getViewerContext } from "@/lib/player-session";
import { getVisibleSectionLinks } from "@/lib/queries";

const links = [
  { href: "/regions", label: "Regions" },
  { href: "/characters", label: "Characters" },
  { href: "/factions", label: "Factions" },
  { href: "/storylines", label: "Storylines" },
  { href: "/artifacts", label: "Artifacts" },
  { href: "/timeline", label: "Timeline" },
  { href: "/maps", label: "Maps" },
];

async function logoutAction() {
  "use server";
  const session = await getPlayerSession();
  session.destroy();
  redirect("/");
}

async function getLoggedInDisplayName(): Promise<string | null> {
  const session = await getPlayerSession();
  if (!session.playerId) return null;
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT display_name FROM players WHERE id = ?",
    args: [session.playerId],
  });
  return r.rows[0] ? (r.rows[0].display_name as string) : null;
}

export default async function NavBar() {
  const displayName = await getLoggedInDisplayName();
  const viewer = await getViewerContext();
  const sectionLinks = await getVisibleSectionLinks(viewer);
  const allLinks = [...links, ...sectionLinks.map((s) => ({ href: `/sections/${s.slug}`, label: s.name }))];

  return (
    <header className="border-b border-gold/20 bg-ink/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="font-display text-xl tracking-wide text-gold hover:text-parchment transition-colors">
          Erendyl Codex
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-parchment/80">
          {allLinks.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gold transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <form action="/search" className="flex items-center">
            <input
              type="text"
              name="q"
              placeholder="Search the codex..."
              className="w-36 sm:w-56 rounded-full bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
            />
          </form>
          {displayName ? (
            <div className="flex items-center gap-2 text-sm">
              <Link href="/me" className="text-gold hover:underline whitespace-nowrap">
                {displayName}
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="text-xs text-parchment/40 hover:text-blood">Log out</button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10 whitespace-nowrap"
            >
              Log In
            </Link>
          )}
        </div>
      </div>
      <nav className="md:hidden flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-xs text-parchment/70">
        {allLinks.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-gold transition-colors">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
