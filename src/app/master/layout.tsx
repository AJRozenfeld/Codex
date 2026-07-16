import Link from "next/link";
import { redirect } from "next/navigation";
import { getMasterSession } from "@/lib/auth";

// The license-issuer console (2026-07-16). Master-only - completely separate
// session from both DM admin and players; see middleware.ts for the gate.

async function logoutAction() {
  "use server";
  const session = await getMasterSession();
  session.destroy();
  redirect("/master/login");
}

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-parchment">
      <div className="relative border-b border-gold/20 bg-void/70 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 font-display text-gold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/sigil.png" alt="" aria-hidden className="h-6 w-6 object-contain drop-shadow-[0_0_5px_rgba(218,185,98,0.5)]" />
            Master Console
          </span>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/admin" className="text-parchment/65 hover:text-gold transition-colors">
              DM Console
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="text-parchment/65 hover:text-blood transition-colors">
                Log out
              </button>
            </form>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
      </div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}
