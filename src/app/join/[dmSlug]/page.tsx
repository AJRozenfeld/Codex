import Link from "next/link";
import { redirect } from "next/navigation";
import { getDmBySlug, registerPlayer } from "@/lib/dm-queries";

export const dynamic = "force-dynamic";

// Player self-registration (2026-07-16): each DM shares their own
// /join/<slug> link. Accounts created here belong to that DM's namespace
// (usernames unique per DM) and start unassigned - the DM places them into
// a campaign from /admin/players.

async function registerAction(dmSlug: string, formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    redirect(`/join/${dmSlug}?error=${encodeURIComponent("Passwords don't match.")}`);
  }
  const result = await registerPlayer(dmSlug, username, displayName, password);
  if (!result.ok) {
    redirect(`/join/${dmSlug}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/join/${dmSlug}?done=1`);
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: { dmSlug: string };
  searchParams: { error?: string; done?: string };
}) {
  const dm = await getDmBySlug(params.dmSlug);
  if (!dm || !dm.isActive) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <h1 className="font-display text-2xl text-gold mb-3">Unknown table</h1>
        <p className="text-sm text-parchment/60">This join link isn&apos;t active. Double-check it with your DM.</p>
      </div>
    );
  }

  if (searchParams?.done) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <h1 className="font-display text-2xl text-gold mb-3">You&apos;re in!</h1>
        <p className="text-sm text-parchment/60 mb-8">
          Your account is created. Your DM will add you to a campaign - once they do, everything appears when
          you log in.
        </p>
        <Link
          href={`/login/${dm.slug}`}
          className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold transition-colors"
        >
          Log in
        </Link>
      </div>
    );
  }

  const register = registerAction.bind(null, params.dmSlug);

  return (
    <div className="max-w-md mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">Join {dm.name}&apos;s game</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">Create your player account for this table.</p>
      <form action={register} className="space-y-4">
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
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Display name</span>
          <input
            type="text"
            name="displayName"
            required
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
          Create Account
        </button>
        <p className="text-xs text-parchment/40 text-center">
          Already have an account? <Link href={`/login/${dm.slug}`} className="text-gold hover:underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
