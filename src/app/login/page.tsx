import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { getPlayerSession } from "@/lib/player-session";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT id, password_hash FROM players WHERE username = ?",
    args: [username],
  });
  const row = r.rows[0];
  if (!row || !verifyPassword(password, row.password_hash as string)) {
    redirect("/login?error=1");
  }

  const session = await getPlayerSession();
  session.playerId = row.id as string;
  await session.save();
  redirect("/me");
}

export default async function PlayerLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="max-w-sm mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">Player Access</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">
        Log in with the account your DM set up for you.
      </p>
      <form action={loginAction} className="space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Username</span>
          <input
            type="text"
            name="username"
            autoFocus
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Password</span>
          <input
            type="password"
            name="password"
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
          />
        </label>
        {searchParams.error && (
          <p className="text-sm text-red-400">Incorrect username or password.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors"
        >
          Log In
        </button>
      </form>
    </div>
  );
}
