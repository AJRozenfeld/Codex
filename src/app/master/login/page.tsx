import { redirect } from "next/navigation";
import { getMasterSession, checkMasterPassword, isMasterAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkMasterPassword(password)) {
    redirect("/master/login?error=1");
  }
  const session = await getMasterSession();
  session.isMaster = true;
  await session.save();
  redirect("/master");
}

export default async function MasterLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (await isMasterAuthed()) redirect("/master");

  return (
    <div className="max-w-sm mx-auto py-16">
      <h1 className="font-display text-2xl text-gold mb-2 text-center">Master Access</h1>
      <p className="text-sm text-parchment/50 text-center mb-8">License management. Authorized eyes only.</p>
      <form action={loginAction} className="space-y-4">
        <input
          type="password"
          name="password"
          placeholder="Master password"
          autoFocus
          required
          className="w-full rounded-lg bg-void border border-gold/30 px-4 py-2.5 text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70"
        />
        {searchParams.error && <p className="text-sm text-red-400">Incorrect password.</p>}
        <button type="submit" className="w-full rounded-lg bg-gold/90 text-ink py-2.5 font-medium hover:bg-gold transition-colors">
          Enter
        </button>
      </form>
    </div>
  );
}
