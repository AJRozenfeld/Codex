import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { verifyPassword, hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

async function changePasswordAction(formData: FormData) {
  "use server";
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  await ensureSchema();
  const db = getDb();
  const r = await db.execute({
    sql: "SELECT password_hash FROM players WHERE id = ?",
    args: [session.playerId],
  });
  const storedHash = r.rows[0]?.password_hash as string | undefined;
  if (!storedHash || !verifyPassword(currentPassword, storedHash)) {
    redirect("/me/password?error=current");
  }
  if (newPassword.length < 6) {
    redirect("/me/password?error=short");
  }
  if (newPassword !== confirmPassword) {
    redirect("/me/password?error=mismatch");
  }

  await db.execute({
    sql: "UPDATE players SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
    args: [hashPassword(newPassword), session.playerId],
  });
  redirect("/me/password?success=1");
}

const ERROR_MESSAGES: Record<string, string> = {
  current: "Your current password was incorrect.",
  short: "New password must be at least 6 characters.",
  mismatch: "New password and confirmation didn't match.",
};

export default async function MyPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");

  return (
    <div className="max-w-sm">
      <Link href="/me" className="text-sm text-parchment/50 hover:text-gold">&larr; Back</Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">Change Password</h1>
      </div>
      <form action={changePasswordAction} className="space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Current Password</span>
          <input
            type="password"
            name="currentPassword"
            required
            autoFocus
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">New Password</span>
          <input
            type="password"
            name="newPassword"
            required
            minLength={6}
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Confirm New Password</span>
          <input
            type="password"
            name="confirmPassword"
            required
            minLength={6}
            className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        {searchParams.error && (
          <p className="text-sm text-red-400">
            {ERROR_MESSAGES[searchParams.error] ?? "Something went wrong. Please try again."}
          </p>
        )}
        {searchParams.success && <p className="text-sm text-gold">Password updated.</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors"
        >
          Update Password
        </button>
      </form>
    </div>
  );
}
