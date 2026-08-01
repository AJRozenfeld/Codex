import Link from "next/link";
import { LibraryPager, paginateLibrary } from "@/components/LibraryPager";
import { redirect } from "next/navigation";
import { listCreatureSummaries, upsertCreature, copyLibraryCreatureToCampaign, type CreatureSummary } from "@/lib/creature-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const id = await upsertCreature(campaignId, { name, source: "Homebrew" });
  redirect(`/admin/creatures/${id}`);
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const newId = await copyLibraryCreatureToCampaign(campaignId, id);
  redirect(newId ? `/admin/creatures/${newId}` : "/admin/creatures");
}

function CreatureTable({ rows, library }: { rows: CreatureSummary[]; library: boolean }) {
  return (
    <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
          <tr>
            <th className="px-4 py-2"></th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">CR</th>
            <th className="px-4 py-2">HP</th>
            <th className="px-4 py-2">AC</th>
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
              <td className="px-4 py-2">
                {c.portraitPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.portraitPath} alt="" className="h-8 w-8 rounded-full object-cover border border-gold/20" />
                ) : (
                  <span className="block h-8 w-8 rounded-full bg-void/60 border border-gold/10" />
                )}
              </td>
              <td className="px-4 py-2 text-parchment">{c.name}</td>
              <td className="px-4 py-2 text-parchment/50">{c.creatureType || "\u2014"}</td>
              <td className="px-4 py-2 text-parchment/50">{c.challengeRating || "\u2014"}</td>
              <td className="px-4 py-2 text-parchment/50">{c.hp ?? ""}</td>
              <td className="px-4 py-2 text-parchment/50">{c.ac ?? ""}</td>
              <td className="px-4 py-2 text-parchment/40 text-xs">{c.source || "\u2014"}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {library ? (
                  <span className="inline-flex items-center gap-3">
                    <Link href={`/admin/creatures/${c.id}`} className="text-gold hover:underline">View</Link>
                    <form action={copyAction.bind(null, c.id)} className="inline">
                      <button type="submit" className="text-gold hover:underline">Copy to Campaign</button>
                    </form>
                  </span>
                ) : (
                  <Link href={`/admin/creatures/${c.id}`} className="text-gold hover:underline">Edit</Link>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-parchment/40">
                {library ? "The platform library is empty." : "No creatures of your own yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminCreaturesPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const all = await listCreatureSummaries(campaignId);
  const mine = all.filter((c) => !c.inLibrary);
  const library = all.filter((c) => c.inLibrary);
  const { pageRows, page, totalPages, totalCount } = paginateLibrary(library, searchParams.q ?? "", searchParams.page);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-gold">Bestiary</h1>
          <p className="text-sm text-parchment/40 mt-1 max-w-2xl">
            A monster library with full stat blocks - reuse any of these across as many{" "}
            <Link href="/admin/scenes" className="text-gold hover:underline">Scenes</Link>{" "}
            as you like. Create one from a blank template below, or{" "}
            <Link href="/admin/creatures/import" className="text-gold hover:underline">bulk-import a whole list at once</Link>.
          </p>
        </div>
        <Link
          href="/admin/creatures/import"
          className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm font-medium hover:bg-gold/10 whitespace-nowrap"
        >
          Bulk Import
        </Link>
      </div>

      <form action={createAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-4 max-w-xl">
        <Field label="New Creature Name" name="name" required className="flex-1 min-w-[14rem]" />
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold h-fit">
          + Create From Blank Template
        </button>
      </form>

      <h2 className="font-display text-lg text-gold mb-3">Your Creatures</h2>
      <CreatureTable rows={mine} library={false} />

      <h2 className="font-display text-lg text-gold mt-10 mb-1">Platform Library</h2>
      <p className="text-sm text-parchment/40 mb-3 max-w-2xl">
        The shared bestiary every DM draws from. Use these directly in Scenes, or copy one into your
        campaign to make it your own and tweak it.
      </p>
      <LibraryPager path="/admin/creatures" q={searchParams.q ?? ""} page={page} totalPages={totalPages} totalCount={totalCount} />
      <CreatureTable rows={pageRows} library={true} />
    </div>
  );
}
