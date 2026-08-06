import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentDmId } from "@/lib/dm-queries";
import { getSheetTemplateForEdit, updateSheetTemplate } from "@/lib/sheet-template-queries";
import { SheetTemplateEditor } from "@/components/SheetTemplateEditor";

export const dynamic = "force-dynamic";

export default async function EditSheetSystemPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; saved?: string };
}) {
  const dmId = await getCurrentDmId();
  const template = await getSheetTemplateForEdit(dmId, params.id);
  if (!template) notFound();

  async function saveAction(formData: FormData) {
    "use server";
    const activeDmId = await getCurrentDmId();
    let rawDef: unknown = null;
    try {
      rawDef = JSON.parse(String(formData.get("definitionJson") ?? "{}"));
    } catch {
      rawDef = null;
    }
    const r = await updateSheetTemplate(activeDmId, params.id, String(formData.get("name") ?? ""), rawDef);
    if (!r.ok) {
      // The editor validates live with the same rules, so landing here is
      // rare (a race, or a tampered payload) - the message is enough.
      redirect(`/admin/sheets/${params.id}?error=${encodeURIComponent(r.error)}`);
    }
    redirect(`/admin/sheets/${params.id}?saved=1`);
  }

  return (
    <div className="max-w-5xl">
      <Link href="/admin/sheets" className="text-sm text-parchment/50 hover:text-gold">&larr; All sheet systems</Link>
      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl text-gold">Edit Sheet System</h1>
        <p className="text-sm text-parchment/50 mt-1">
          Changes apply to every campaign using this system the moment you save - players&apos; sheets re-render through the new rules
          on their next page load. Stored sheet data is never modified.
        </p>
      </div>

      {searchParams?.error && (
        <div className="mb-4 rounded-lg border border-blood/50 bg-void p-3 text-sm text-blood">{searchParams.error}</div>
      )}
      {searchParams?.saved && (
        <div className="mb-4 rounded-lg border border-gold/40 bg-void p-3 text-sm text-gold">Sheet system saved.</div>
      )}

      <SheetTemplateEditor
        templateId={template.id}
        initialName={template.name}
        initialDef={template.def}
        saveAction={saveAction}
        serverIssues={[]}
      />
    </div>
  );
}
