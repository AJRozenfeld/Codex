import Link from "next/link";
import { LibraryPager, paginateLibrary } from "@/components/LibraryPager";
import { redirect } from "next/navigation";
import { listSpells, upsertSpell, copyLibrarySpellToCampaign } from "@/lib/library-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field } from "@/components/AdminForm";
import type { Spell } from "@/lib/types";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const id = await upsertSpell(campaignId, { name, source: "Homebrew" });
  redirect(`/admin/spells/${id}`);
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const newId = await copyLibrarySpellToCampaign(campaignId, id);
  redirect(newId ? `/admin/spells/${newId}` : "/admin/spells");
}

function levelLabel(l: number) {
  return l === 0 ? "Cantrip" : `Level ${l}`;
}

function SpellTable({ rows, library }: { rows: Spell[]; library: boolean }) {
  return (
    <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Level</th>
            <th className="px-4 py-2">School</th>
            <th className="px-4 py-2">Classes</th>
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
              <td className="px-4 py-2 text-parchment">
                {c.name}
                {c.details.concentration && <span className="ml-2 text-xs text-ember/70">C</span>}
                {c.details.ritual && <span className="ml-1 text-xs text-ember/70">R</span>}
              </td>
              <td className="px-4 py-2 text-parchment/50">{levelLabel(c.level)}</td>
              <td className="px-4 py-2 text-parchment/50">{c.school || "—"}</td>
              <td className="px-4 py-2 text-parchment/50 text-xs">{c.details.classes || "—"}</td>
              <td className="px-4 py-2 text-parchment/40 text-xs">{c.source || "—"}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {library ? (
                  <span className="inline-flex items-center gap-3">
                    <Link href={`/admin/spells/${c.id}`} className="text-gold hover:underline">View</Link>
                    <form action={copyAction.bind(null, c.id)} className="inline">
                      <button type="submit" className="text-gold hover:underline">Copy to Campaign</button>
                    </form>
                  </span>
                ) : (
                  <Link href={`/admin/spells/${c.id}`} className="text-gold hover:underline">Edit</Link>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-parchment/40">
                {library ? "The platform library is empty." : "No spells of your own yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminSpellsPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const all = await listSpells(campaignId);
  const mine = all.filter((c) => c.campaignId !== null);
  const library = all.filter((c) => c.campaignId === null);
  const { pageRows, page, totalPages, totalCount } = paginateLibrary(library, searchParams.q ?? "", searchParams.page);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-gold">Spells</h1>
          <p className="text-sm text-parchment/40 mt-1 max-w-2xl">
            The grimoire - the platform library carries the full SRD spell list (sorted by level), and your
            homebrew spells live beside it. Create one below, or{" "}
            <Link href="/admin/spells/import" className="text-gold hover:underline">bulk-import a list</Link>.
            <span className="text-parchment/30"> C = concentration, R = ritual.</span>
          </p>
        </div>
        <Link href="/admin/spells/import" className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm font-medium hover:bg-gold/10 whitespace-nowrap">
          Bulk Import
        </Link>
      </div>

      <form action={createAction} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-gold/15 p-4 max-w-xl">
        <Field label="New Spell Name" name="name" required className="flex-1 min-w-[14rem]" />
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold h-fit">
          + Create Spell
        </button>
      </form>

      <h2 className="font-display text-lg text-gold mb-3">Your Spells</h2>
      <SpellTable rows={mine} library={false} />

      <h2 className="font-display text-lg text-gold mt-10 mb-1">Platform Library</h2>
      <p className="text-sm text-parchment/40 mb-3 max-w-2xl">
        The shared grimoire every DM draws from. Copy a spell into your campaign to make it your own and tweak it.
      </p>
      <LibraryPager path="/admin/spells" q={searchParams.q ?? ""} page={page} totalPages={totalPages} totalCount={totalCount} />
      <SpellTable rows={pageRows} library={true} />
    </div>
  );
}
