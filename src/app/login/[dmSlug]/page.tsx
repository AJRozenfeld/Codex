import Link from "next/link";
import { redirect } from "next/navigation";
import { getDmBySlug, playerLogin } from "@/lib/dm-queries";
import { getPlayerSession } from "@/lib/player-session";

export const dynamic = "force-dynamic";

// Per-DM player login (2026-07-16). Player usernames are only unique within
// one DM's namespace, so the login page must know whose table you're at -
// that's this slug. (The bare /login stays pinned to the founder's players.)

async function loginAction(dmSlug: string, formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const dm = await getDmBySlug(dmSlug);
  if (!dm || !dm.isActive) {
    redirect(`/login/${dmSlug}?error=1`);
  }
  const playerId = await playerLogin(dm.id, username, password);
  if (!playerId) {
    redirect(`/login/${dmSlug}?error=1`);
  }
  const session = await getPlayerSession();
  session.playerId = playerId;
  await session.save();
  redirect("/me");
}

export default async function ScopedPlayerLoginPage({
  params,
  searchParams,
}: {
  params: { dmSlug: string };
  searchParams: { error?: string };
}) {
  const dm = await getDmBySlug(params.dmSlug);
  if (!dm || !dm.isActive) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <h1 className="font-display text-2xl text-gold mb-3">Unknown table</h1>
        <p className="text-sm text-parchment/60">This login link isn&apos;t active. Double-check it with your DM.</p>
      </div>
    );
  }

  const login = loginAction.bind(null, params.dmSlug);

  return (
    <div className="max-w-sm mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">{dm.name}&apos;s table</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">Log in with your player account.</p>
      <form action={login} className="space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Username</span>
          <input
            type="text"
            name="username"
            autoFocus
            required
            autoComplete="username"
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        {searchParams?.error && <p className="text-sm text-red-400">Incorrect username or password.</p>}
        <button type="submit" className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors">
          Enter the Codex
        </button>
        <p className="text-xs text-parchment/40 text-center">
          New here? <Link href={`/join/${dm.slug}`} className="text-gold hover:underline">Create your account</Link>
        </p>
      </form>
    </div>
  );
}
