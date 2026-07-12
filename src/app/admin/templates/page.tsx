import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGetTemplates, adminDeleteTemplate } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

async function deleteAction(id: string) {
  "use server";
  const result = await adminDeleteTemplate(id);
  redirect(result.deleted ? "/admin/templates" : `/admin/templates?blockedDelete=${result.articleCount}`);
}

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: { blockedDelete?: string };
}) {
  const templates = await adminGetTemplates();
  const blockedCount = searchParams.blockedDelete ? Number(searchParams.blockedDelete) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="font-display text-2xl text-gold">Templates</h1>
          <p className="text-sm text-parchment/50 mt-1 max-w-xl">
            Custom article shapes, shared across every campaign in this Codex (not scoped to the campaign you're
            currently editing). Bind an Article List to a template from a section's editor to start creating
            articles with it.
          </p>
        </div>
        <Link href="/admin/templates/new" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-sm font-medium hover:bg-gold whitespace-nowrap">
          + New Template
        </Link>
      </div>

      {blockedCount != null && blockedCount > 0 && (
        <div className="mt-4 rounded-lg border border-blood/40 bg-blood/10 px-4 py-2 text-sm text-blood">
          Can&apos;t delete - {blockedCount} article{blockedCount === 1 ? "" : "s"} across your campaigns still use
          this template. Remove or reassign them first.
        </div>
      )}

      <div className="mt-6 rounded-lg border border-gold/15 overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Fields</th>
              <th className="px-4 py-2">Articles (all campaigns)</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                <td className="px-4 py-2 text-parchment">
                  <div>{t.name}</div>
                  {t.description && <div className="text-xs text-parchment/40 mt-0.5">{t.description}</div>}
                </td>
                <td className="px-4 py-2 text-parchment/70">{t.fieldCount}</td>
                <td className="px-4 py-2 text-parchment/70">{t.articleCount}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/templates/${t.id}`} className="text-gold hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-parchment/40">No templates yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
