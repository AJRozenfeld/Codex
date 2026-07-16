import Link from "next/link";
import { redirect } from "next/navigation";
import { getDmByInviteToken, claimDmAccount } from "@/lib/dm-queries";

export const dynamic = "force-dynamic";

// One-time license claim page (2026-07-16): the DM opens the invite link the
// master issued, picks a username + password, and lands with a blank
// campaign ready in the DM console.

async function claimAction(token: string, formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    redirect(`/claim/${token}?error=${encodeURIComponent("Passwords don't match.")}`);
  }
  const result = await claimDmAccount(token, username, password);
  if (!result.ok) {
    redirect(`/claim/${token}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/claim/${token}?done=1`);
}

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string; done?: string };
}) {
  if (searchParams?.done) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <h1 className="font-display text-2xl text-gold mb-3">Welcome, Dungeon Master</h1>
        <p className="text-sm text-parchment/60 mb-8">
          Your account is ready, and a blank campaign awaits. Log in to start building your world.
        </p>
        <Link
          href="/admin/login"
          className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold transition-colors"
        >
          Go to DM login
        </Link>
      </div>
    );
  }

  const account = await getDmByInviteToken(params.token);
  if (!account) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <h1 className="font-display text-2xl text-gold mb-3">Invalid invite</h1>
        <p className="text-sm text-parchment/60">
          This claim link is invalid or was already used. Ask your license issuer for a fresh one.
        </p>
      </div>
    );
  }

  const claim = claimAction.bind(null, params.token);

  return (
    <div className="max-w-md mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">Claim your license</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">
        License: <span className="text-gold">{account.name}</span>. Choose the credentials you&apos;ll use to
        log into your DM console.
      </p>
      <form action={claim} className="space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Username</span>
          <input
            type="text"
            name="username"
            required
            autoFocus
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
            autoComplete="new-password"
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Confirm password</span>
          <input
            type="password"
            name="confirm"
            required
            autoComplete="new-password"
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        {searchParams?.error && <p className="text-sm text-red-400">{searchParams.error}</p>}
        <button type="submit" className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors">
          Claim License
        </button>
      </form>
    </div>
  );
}
