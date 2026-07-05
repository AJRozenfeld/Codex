import { isAdminAuthed } from "@/lib/auth";
import { adminGetCampaign } from "@/lib/campaign-queries";
import { buildCampaignExportZip } from "@/lib/campaign-io/export";
import { ENTITY_TYPES } from "@/lib/campaign-io/registry";

// Plain Route Handler (not a server action) - the whole point is to return a
// raw file download, which server actions can't do. Guarded twice: the
// middleware already blocks any unauthenticated request to /admin/*, and
// isAdminAuthed() here is defense-in-depth in case that ever changes.
export async function POST(request: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return new Response("Not authorized", { status: 401 });
  }

  const formData = await request.formData();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) {
    return new Response("No campaign selected.", { status: 400 });
  }
  const campaign = await adminGetCampaign(campaignId);
  if (!campaign) {
    return new Response("Campaign not found.", { status: 404 });
  }

  const types: Record<string, string[]> = {};
  for (const type of ENTITY_TYPES) {
    types[type] = formData.getAll(`sel_${type}`).map(String);
  }

  const { buffer, imageWarnings } = await buildCampaignExportZip(campaignId, { types });

  const filename = `${campaign.slug}-export-${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Surfaced for debugging via browser devtools if an image silently
      // dropped out of the export - not shown to the DM directly since a
      // file download has no room for a results page.
      "X-Image-Warnings": String(imageWarnings.length),
    },
  });
}
