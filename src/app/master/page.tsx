import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  masterListDms,
  masterCreateDm,
  masterUpdateDm,
  masterSetDmActive,
  masterRegenerateInvite,
  masterDeleteDm,
} from "@/lib/dm-queries";
import { LEGACY_DM_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The license dashboard (2026-07-16). Issue a license -> share the one-time
// claim link -> the DM sets their credentials there and gets a blank
// campaign. Quotas are per campaign (players/articles/maps) plus a
// campaign count per license; edits apply immediately.
// ---------------------------------------------------------------------------

function quotasFrom(formData: FormData) {
  const num = (key: string, fallback: number) => {
    const n = Number(formData.get(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    maxCampaigns: num("maxCampaigns", 1),
    maxPlayersPerCampaign: num("maxPlayersPerCampaign", 8),
    maxArticlesPerCampaign: num("maxArticlesPerCampaign", 200),
    maxMapsPerCampaign: num("maxMapsPerCampaign", 10),
  };
}

async function createAction(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/master?error=Name%20is%20required");
  const account = await masterCreateDm(name, quotasFrom(formData));
  redirect(`/master?created=${account.id}`);
}

async function updateAction(id: string, formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (name) await masterUpdateDm(id, name, quotasFrom(formData));
  redirect("/master");
}

async function toggleActiveAction(id: string, active: boolean) {
  "use server";
  await masterSetDmActive(id, active);
  redirect("/master");
}

async function regenerateInviteAction(id: string) {
  "use server";
  await masterRegenerateInvite(id);
  redirect(`/master?created=${id}`);
}

async function deleteAction(id: string) {
  "use server";
  try {
    await masterDeleteDm(id);
  } catch (err) {
    redirect(`/master?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect("/master");
}

export default async function MasterDashboard({
  searchParams,
}: {
  searchParams: { created?: string; error?: string };
}) {
  const licenses = await masterListDms();
  const host = headers().get("host") ?? "";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";

  return (
    <div>
      <h1 className="font-display text-3xl text-gold mb-2">Licenses</h1>
      <p className="text-parchment/60 mb-8 text-sm">
        Each license is a DM account with its own campaigns, players and quotas. Issue one, send the claim
        link, and the DM takes it from there.
      </p>

      {searchParams?.error && <p className="text-sm text-blood mb-4">{searchParams.error}</p>}

      <div className="rounded-lg border border-gold/20 bg-void p-5 mb-10">
        <h2 className="font-display text-lg text-gold mb-4">Issue a new license</h2>
        <form action={createAction} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">License name (e.g. the DM&apos;s name)</span>
            <input type="text" name="name" required className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Max campaigns</span>
            <input type="number" name="maxCampaigns" defaultValue={1} min={1} className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Max players / campaign</span>
            <input type="number" name="maxPlayersPerCampaign" defaultValue={8} min={1} className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Max articles / campaign</span>
            <input type="number" name="maxArticlesPerCampaign" defaultValue={200} min={1} className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70" />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Max maps / campaign</span>
            <input type="number" name="maxMapsPerCampaign" defaultValue={10} min={0} className="w-full rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
              Create License
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-6">
        {licenses.map((l) => {
          const isFounder = l.id === LEGACY_DM_ID;
          const claimUrl = l.inviteToken ? `${proto}://${host}/claim/${l.inviteToken}` : null;
          const justCreated = searchParams?.created === l.id;
          return (
            <div
              key={l.id}
              className={`rounded-lg border p-5 bg-void ${justCreated ? "border-gold/60" : "border-gold/15"}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="font-display text-lg text-parchment">
                    {l.name}{" "}
                    {isFounder && <span className="text-xs text-gold/70">(founder)</span>}
                    {!l.isActive && <span className="text-xs text-blood ml-2">deactivated</span>}
                  </h3>
                  <p className="text-xs text-parchment/50 mt-1">
                    {l.username ? (
                      <>DM login: <code className="text-gold/80">{l.username}</code></>
                    ) : isFounder ? (
                      <>Logs in with the master password</>
                    ) : (
                      <>Not claimed yet</>
                    )}
                    {" · "}join slug: <code className="text-gold/80">/join/{l.slug}</code>
                  </p>
                  <p className="text-xs text-parchment/50 mt-1">
                    {l.campaignCount}/{l.maxCampaigns >= 999999 ? "∞" : l.maxCampaigns} campaigns ·{" "}
                    {l.playerCount} players · quotas per campaign:{" "}
                    {l.maxPlayersPerCampaign >= 999999 ? "∞" : l.maxPlayersPerCampaign} players,{" "}
                    {l.maxArticlesPerCampaign >= 999999 ? "∞" : l.maxArticlesPerCampaign} articles,{" "}
                    {l.maxMapsPerCampaign >= 999999 ? "∞" : l.maxMapsPerCampaign} maps
                  </p>
                </div>
                {!isFounder && (
                  <div className="flex items-center gap-3 text-xs">
                    <form action={regenerateInviteAction.bind(null, l.id)}>
                      <button type="submit" className="text-gold hover:underline">New invite link</button>
                    </form>
                    <form action={toggleActiveAction.bind(null, l.id, !l.isActive)}>
                      <button type="submit" className="text-parchment/60 hover:text-gold">
                        {l.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                    <form action={deleteAction.bind(null, l.id)}>
                      <button type="submit" className="text-blood/80 hover:text-blood hover:underline">
                        Delete
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {claimUrl && (
                <div className="mt-3 rounded border border-ember/30 bg-ink p-3">
                  <p className="text-xs uppercase tracking-widest text-ember/80 mb-1">One-time claim link (share with the DM)</p>
                  <code className="block text-gold text-sm break-all select-all">{claimUrl}</code>
                </div>
              )}

              {!isFounder && (
                <details className="mt-3">
                  <summary className="text-xs text-parchment/50 cursor-pointer hover:text-gold">Edit name / quotas</summary>
                  <form action={updateAction.bind(null, l.id)} className="grid gap-3 sm:grid-cols-5 mt-3">
                    <label className="block sm:col-span-2">
                      <span className="block text-[10px] uppercase tracking-widest text-ember/80 mb-1">Name</span>
                      <input type="text" name="name" defaultValue={l.name} className="w-full rounded bg-ink border border-gold/30 px-2 py-1.5 text-sm text-parchment" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-widest text-ember/80 mb-1">Campaigns</span>
                      <input type="number" name="maxCampaigns" defaultValue={l.maxCampaigns} min={1} className="w-full rounded bg-ink border border-gold/30 px-2 py-1.5 text-sm text-parchment" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-widest text-ember/80 mb-1">Players</span>
                      <input type="number" name="maxPlayersPerCampaign" defaultValue={l.maxPlayersPerCampaign} min={1} className="w-full rounded bg-ink border border-gold/30 px-2 py-1.5 text-sm text-parchment" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-widest text-ember/80 mb-1">Articles</span>
                      <input type="number" name="maxArticlesPerCampaign" defaultValue={l.maxArticlesPerCampaign} min={1} className="w-full rounded bg-ink border border-gold/30 px-2 py-1.5 text-sm text-parchment" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-widest text-ember/80 mb-1">Maps</span>
                      <input type="number" name="maxMapsPerCampaign" defaultValue={l.maxMapsPerCampaign} min={0} className="w-full rounded bg-ink border border-gold/30 px-2 py-1.5 text-sm text-parchment" />
                    </label>
                    <div className="sm:col-span-5">
                      <button type="submit" className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs hover:bg-gold/10">
                        Save
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
