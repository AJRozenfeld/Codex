import Link from "next/link";
import { redirect } from "next/navigation";
import { getBlueprint, saveBlueprint, listDraftsForCampaign, approveDraft, rejectDraft } from "@/lib/blueprint-queries";
import { sanitizeBlueprintSteps, type BlueprintStep, type StepAnswer } from "@/lib/blueprint-shared";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { BlueprintEditor } from "@/components/BlueprintEditor";

export const dynamic = "force-dynamic";

async function saveAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  let raw: unknown = [];
  try { raw = JSON.parse(String(formData.get("steps") ?? "[]")); } catch { raw = []; }
  const steps = sanitizeBlueprintSteps(raw);
  await saveBlueprint(campaignId, { enabled: formData.get("enabled") === "1", steps });
}

async function approveAction(draftId: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const bp = await getBlueprint(campaignId);
  try {
    await approveDraft(campaignId, draftId, bp.steps);
  } catch (err) {
    redirect(`/admin/creation?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect("/admin/creation?approved=1");
}

async function rejectAction(draftId: string, formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await rejectDraft(campaignId, draftId, String(formData.get("note") ?? "").trim());
  redirect("/admin/creation");
}

/** A compact human-readable rendering of one draft's answers for review. */
function answerSummary(steps: BlueprintStep[], answers: Record<string, StepAnswer>): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  for (const step of steps) {
    const a = answers[step.id];
    if (!a) { out.push({ title: step.title, text: "(not answered)" }); continue; }
    if (a.kind === "stats") {
      out.push({ title: step.title, text: Object.entries(a.scores).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ") + (a.rolled ? `\nRolls: ${a.rolled.breakdowns.join(" | ")}` : "") });
    } else if (a.kind === "choice" && step.kind === "choice") {
      out.push({ title: step.title, text: step.options.find((o) => o.id === a.optionId)?.name ?? "(unknown option)" });
    } else if (a.kind === "equipment") {
      out.push({ title: step.title, text: `${a.itemIds.length} items` });
    } else if (a.kind === "spells") {
      out.push({ title: step.title, text: `${a.spellIds.length} spells` });
    } else if (a.kind === "text" && step.kind === "text") {
      out.push({ title: step.title, text: step.prompts.map((p) => a.values[p.id] ? `${p.label}: ${a.values[p.id].slice(0, 200)}` : null).filter(Boolean).join("\n") || "(empty)" });
    }
  }
  return out;
}

export default async function AdminCreationPage({ searchParams }: { searchParams: { error?: string; approved?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const [bp, drafts] = await Promise.all([getBlueprint(campaignId), listDraftsForCampaign(campaignId)]);
  const submitted = drafts.filter((d) => d.status === "submitted");
  const others = drafts.filter((d) => d.status !== "submitted");

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl text-gold mb-2">Character Creation</h1>
      <p className="text-sm text-parchment/40 mb-6 max-w-2xl">
        Configure how players create characters in this campaign: the steps they walk, how ability scores
        are determined, and what they may pick from the platform{" "}
        <Link href="/admin/equipment" className="text-gold hover:underline">equipment</Link> and{" "}
        <Link href="/admin/spells" className="text-gold hover:underline">spell</Link> libraries.
        {bp.isDefault && " You are looking at the seeded 5e default - save to make it this campaign's own."}
      </p>

      {searchParams.error && <p className="text-sm text-blood mb-4">{searchParams.error}</p>}
      {searchParams.approved && <p className="text-sm text-gold mb-4">Draft approved - character created and linked to the player.</p>}

      {submitted.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-lg text-gold mb-3">Awaiting Approval</h2>
          <div className="space-y-4">
            {submitted.map((d) => (
              <div key={d.id} className="rounded-lg border border-gold/30 bg-void/40 p-4">
                <p className="text-parchment font-semibold mb-2">{d.playerName} <span className="text-parchment/40 font-normal text-sm">({d.username})</span></p>
                <div className="space-y-2 mb-4">
                  {answerSummary(bp.steps, d.data.answers).map((s, i) => (
                    <p key={i} className="text-sm text-parchment/70 whitespace-pre-line"><span className="text-ember/80">{s.title}:</span> {s.text}</p>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <form action={approveAction.bind(null, d.id)}>
                    <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">Approve &amp; Create Character</button>
                  </form>
                  <form action={rejectAction.bind(null, d.id)} className="flex items-center gap-2">
                    <input type="text" name="note" placeholder="Feedback for the player (optional)" className="rounded-lg bg-ink border border-gold/30 px-3 py-2 text-parchment text-sm w-64" />
                    <button type="submit" className="text-sm text-blood hover:underline">Send back</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-lg text-gold mb-3">Draft Status</h2>
          <ul className="space-y-1 text-sm text-parchment/60">
            {others.map((d) => (
              <li key={d.id}>
                {d.playerName} — {d.status}{d.status === "approved" && d.characterId ? (
                  <> · <Link href={`/admin/characters/${d.characterId}`} className="text-gold hover:underline">view character</Link></>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="font-display text-lg text-gold mb-3">Blueprint</h2>
      <BlueprintEditor initialEnabled={bp.enabled} initialSteps={bp.steps} saveAction={saveAction} />
    </div>
  );
}
