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
    <header className="relative border-b border-gold/20 bg-ink/85 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/sigil.png"
            alt=""
            aria-hidden
            className="h-7 w-7 object-contain drop-shadow-[0_0_5px_rgba(218,185,98,0.5)] group-hover:drop-shadow-[0_0_9px_rgba(218,185,98,0.8)] transition-all"
          />
          <span className="font-display text-xl tracking-wide text-gold group-hover:text-parchment transition-colors">
            Erendyl Codex
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-parchment/80">
          {allLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative py-1 hover:text-gold transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-0 after:bg-gold after:transition-all hover:after:w-full"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <form action="/search" className="relative flex items-center">
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-parchment/40"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="8.5" cy="8.5" r="6" />
              <path d="M13 13l4.5 4.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              name="q"
              placeholder="Search the codex..."
              className="w-36 sm:w-56 rounded-full bg-void border border-gold/30 pl-8 pr-3 py-1.5 text-sm text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70 transition-colors"
            />
          </form>
          {displayName ? (
            <div className="flex items-center gap-2 text-sm">
              <Link href="/me" className="text-gold hover:underline whitespace-nowrap">
                {displayName}
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="text-xs text-parchment/55 hover:text-blood transition-colors">
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium tracking-wide hover:bg-gold/10 hover:border-gold/70 transition-colors whitespace-nowrap"
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
      <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
    </header>
  );
}
