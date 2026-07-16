import { redirect } from "next/navigation";
import { getAdminSession, checkPassword, isAdminAuthed } from "@/lib/auth";
import { dmLogin } from "@/lib/dm-queries";
import { LEGACY_DM_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

// License system (2026-07-16): two ways in. A licensed DM enters the
// username+password they chose on their /claim invite page. Leaving the
// username BLANK and entering the codex master password (ADMIN_PASSWORD)
// logs into the founder account - exactly how login worked before
// multi-tenancy, so Aviv's muscle memory keeps working.
async function loginAction(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  let dmId: string | null = null;
  if (!username) {
    if (checkPassword(password)) dmId = LEGACY_DM_ID;
  } else {
    dmId = await dmLogin(username, password);
  }
  if (!dmId) {
    redirect("/admin/login?error=1");
  }
  const session = await getAdminSession();
  session.isAdmin = true;
  session.dmId = dmId;
  // Never carry a campaign selection across accounts.
  session.currentCampaignId = undefined;
  await session.save();
  redirect("/admin");
}

export default async function AdminLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (await isAdminAuthed()) redirect("/admin");

  return (
    <div className="max-w-sm mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">DM Access</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">
        Log in with your DM account. Founder? Leave the username blank and use the master password.
      </p>
      <form action={loginAction} className="space-y-4">
        <input
          type="text"
          name="username"
          placeholder="Username (blank for master password)"
          autoFocus
          autoComplete="username"
          className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
        />
        {searchParams.error && (
          <p className="text-sm text-blood-400 text-red-400">Incorrect username or password.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
