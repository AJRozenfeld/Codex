import Link from "next/link";
import { redirect } from "next/navigation";
import { stageCampaignImport } from "@/lib/campaign-io/import";
import { getCurrentDmId } from "@/lib/dm-queries";
import { LEGACY_DM_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

// CLOSED BETA (2026-07-16, Aviv's call): campaign import is founder-only.
// Licensed DMs have no real use for it yet, and it bypassed the per-campaign
// article quota - disabling it closes that hole until the community sharing
// / marketplace system (see IDEA_BOARD) gives imports a proper quota-aware
// path. The guard sits on the page AND inside every server action, so a
// crafted POST can't slip past a hidden link.
function ImportDisabledNote() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-3">Import Campaign</h1>
      <p className="text-sm text-parchment/60">
        Campaign import is disabled during the closed beta. It&apos;s coming back once the
        community sharing system ships - for now, build your world right here in the codex.
      </p>
    </div>
  );
}

async function uploadAction(formData: FormData) {
  "use server";
  if ((await getCurrentDmId()) !== LEGACY_DM_ID) redirect("/admin/campaigns");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/admin/campaigns/import?error=nofile");
  }
  let stagingId: string;
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const staged = await stageCampaignImport(buffer);
    stagingId = staged.stagingId;
  } catch (err) {
    redirect(`/admin/campaigns/import?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect(`/admin/campaigns/import/${stagingId}`);
}

export default async function CampaignImportPage({ searchParams }: { searchParams: { error?: string } }) {
  if ((await getCurrentDmId()) !== LEGACY_DM_ID) return <ImportDisabledNote />;
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl text-gold">Import Campaign</h1>
        <Link href="/admin/campaigns" className="text-xs text-parchment/50 hover:text-gold">&larr; Campaigns</Link>
      </div>
      <p className="text-sm text-parchment/50 mb-6">
        Upload a campaign.md .zip - either one downloaded from{" "}
        <Link href="/admin/campaigns/export" className="text-gold hover:underline">Export Campaign</Link>, or
        hand-authored to the same format. You&apos;ll get a full preview to review and pick from
        before anything is written.
      </p>
      {searchParams?.error && (
        <p className="text-sm text-blood mb-4">
          {searchParams.error === "nofile" ? "Please choose a .zip file first." : searchParams.error}
        </p>
      )}
      <form action={uploadAction} className="space-y-4">
        <input type="file" name="file" accept=".zip" required className="block text-sm text-parchment/70" />
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          Upload &amp; Preview
        </button>
      </form>
    </div>
  );
}
