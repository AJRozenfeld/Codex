import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, ensureSchema } from "@/lib/db";
import { getPlayerSession } from "@/lib/player-session";
import { getBlueprint } from "@/lib/blueprint-queries";
import { getDraftForPlayer, answerStep, rollStatsForStep, submitDraft } from "@/lib/blueprint-queries";
import {
  type BlueprintStep, type StepAnswer, type AbilityKey,
  ABILITIES, ABILITY_LABELS, pointBuyTotal, statMethodSummary,
} from "@/lib/blueprint-shared";
import { SectionHeading } from "@/components/Card";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The player-facing creation wizard (2026-07-31): one blueprint step per
// screen, server-rendered, constraints enforced by the same validators the
// DM's rules define. The finished draft is submitted for DM approval;
// approval turns it into a real character + sheet (blueprint-queries.ts).
// ---------------------------------------------------------------------------

interface Ctx {
  playerId: string;
  campaignId: string;
}

async function requireCreationContext(): Promise<Ctx> {
  const session = await getPlayerSession();
  if (!session.playerId) redirect("/login");
  await ensureSchema();
  const r = await getDb().execute({
    sql: "SELECT campaign_id, character_id FROM players WHERE id = ?",
    args: [session.playerId],
  });
  const row = r.rows[0];
  if (!row) redirect("/login");
  if (row.character_id) redirect("/me/sheet");
  if (!row.campaign_id) redirect("/me?unassigned=1");
  return { playerId: session.playerId, campaignId: row.campaign_id as string };
}

async function stepByIndex(campaignId: string, index: number): Promise<BlueprintStep | null> {
  const bp = await getBlueprint(campaignId);
  return bp.steps[index] ?? null;
}

async function answerAction(index: number, formData: FormData) {
  "use server";
  const ctx = await requireCreationContext();
  const step = await stepByIndex(ctx.campaignId, index);
  if (!step) redirect("/me/create");
  let answer: StepAnswer;
  if (step.kind === "stats") {
    const scores = Object.fromEntries(ABILITIES.map((a) => [a, Number(formData.get(`score_${a}`)) || 0])) as Record<AbilityKey, number>;
    answer = { kind: "stats", scores };
  } else if (step.kind === "choice") {
    answer = { kind: "choice", optionId: String(formData.get("optionId") ?? "") };
  } else if (step.kind === "equipment") {
    answer = { kind: "equipment", itemIds: formData.getAll("itemId").map(String) };
  } else if (step.kind === "spells") {
    answer = { kind: "spells", spellIds: formData.getAll("spellId").map(String) };
  } else {
    const values: Record<string, string> = {};
    for (const p of step.prompts) values[p.id] = String(formData.get(`prompt_${p.id}`) ?? "");
    answer = { kind: "text", values };
  }
  const res = await answerStep(ctx.playerId, ctx.campaignId, step, answer);
  if (!res.ok) redirect(`/me/create?step=${index}&error=${encodeURIComponent(res.error ?? "Invalid answer.")}`);
  redirect(`/me/create?step=${index + 1}`);
}

async function rollAction(index: number) {
  "use server";
  const ctx = await requireCreationContext();
  const step = await stepByIndex(ctx.campaignId, index);
  if (!step || step.kind !== "stats") redirect("/me/create");
  const res = await rollStatsForStep(ctx.playerId, ctx.campaignId, step);
  if (!res.ok) redirect(`/me/create?step=${index}&error=${encodeURIComponent(res.error ?? "Could not roll.")}`);
  redirect(`/me/create?step=${index}`);
}

async function submitAction() {
  "use server";
  const ctx = await requireCreationContext();
  const bp = await getBlueprint(ctx.campaignId);
  const res = await submitDraft(ctx.playerId, ctx.campaignId, bp.steps);
  if (!res.ok) redirect(`/me/create?error=${encodeURIComponent(res.error ?? "Not finished yet.")}`);
  redirect("/me/create");
}

const inputCls = "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70";

function StatFields({ step, answer }: { step: Extract<BlueprintStep, { kind: "stats" }>; answer?: StepAnswer }) {
  const scores = answer?.kind === "stats" ? answer.scores : null;
  const rolled = answer?.kind === "stats" ? answer.rolled : undefined;
  const m = step.method;
  return (
    <div className="space-y-4">
      <p className="text-sm text-parchment/60 italic">{statMethodSummary(m)}</p>
      {m.kind === "pointBuy" && (
        <p className="text-xs text-parchment/50">
          Costs: {Object.keys(m.costTable).sort((a, b) => Number(a) - Number(b)).map((s) => `${s}→${m.costTable[s]}`).join(", ")}
          {scores && pointBuyTotal(scores, m.costTable) !== null && (
            <span className="ml-2 text-gold">Currently spent: {pointBuyTotal(scores, m.costTable)} / {m.budget}</span>
          )}
        </p>
      )}
      {m.kind === "rolled" && rolled && (
        <div className="rounded-lg border border-gold/20 bg-void/40 p-3 text-xs text-parchment/70 space-y-1">
          {rolled.breakdowns.map((b, i) => <p key={i}>🎲 {b}</p>)}
          {!m.assignFreely && <p className="text-parchment/50 italic">Assigned in order: {ABILITIES.map((a, i) => `${a.toUpperCase()} ${rolled.pool[i]}`).join(", ")}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ABILITIES.map((a, i) => (
          <label key={a} className="block">
            <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{ABILITY_LABELS[a]}</span>
            <input
              type="number" name={`score_${a}`}
              defaultValue={scores ? scores[a] : m.kind === "array" ? m.values[i] ?? 10 : m.kind === "rolled" ? (rolled?.pool[i] ?? "") : 10}
              readOnly={m.kind === "rolled" && !m.assignFreely}
              className={inputCls}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export default async function CreateCharacterPage({ searchParams }: { searchParams: { step?: string; error?: string } }) {
  const ctx = await requireCreationContext();
  const bp = await getBlueprint(ctx.campaignId);
  const draft = await getDraftForPlayer(ctx.playerId);

  if (!bp.enabled) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <SectionHeading eyebrow="Character Creation" title="The forge is cold" />
        <p className="text-parchment/60">Your DM has not opened character creation yet. Check back soon, or give them a nudge at the table.</p>
      </div>
    );
  }

  if (draft?.status === "submitted") {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <SectionHeading eyebrow="Character Creation" title="Awaiting the DM's seal" />
        <p className="text-parchment/60">Your character has been submitted. The DM will review it - once approved, your sheet appears under <Link href="/me" className="text-gold hover:underline">My Character</Link>.</p>
      </div>
    );
  }
  if (draft?.status === "approved") redirect("/me/sheet");

  const answers = draft?.data.answers ?? {};
  const total = bp.steps.length;
  const firstUnanswered = bp.steps.findIndex((s) => !answers[s.id]);
  const requested = searchParams.step !== undefined ? Number(searchParams.step) : NaN;
  const stepIndex = Number.isFinite(requested)
    ? Math.max(0, Math.min(requested, total))
    : firstUnanswered === -1 ? total : firstUnanswered;

  const rejectedNote = draft?.status === "rejected" ? draft.dmNote : null;

  // The review screen sits one past the last step.
  const step = stepIndex < total ? bp.steps[stepIndex] : null;

  // Library data for picker steps.
  let equipmentRows: { id: string; name: string; category: string | null; cost: string | null; statLine: string }[] = [];
  let spellRows: { id: string; name: string; level: number; school: string | null }[] = [];
  if (step?.kind === "equipment") {
    const r = await getDb().execute("SELECT id, name, category, cost, details FROM equipment_items WHERE campaign_id IS NULL ORDER BY category, name");
    equipmentRows = r.rows
      .filter((row) => step.categories.length === 0 || step.categories.includes((row.category as string) ?? ""))
      .map((row) => {
        let statLine = "";
        try { statLine = JSON.parse((row.details as string) || "{}").statLine ?? ""; } catch { /* ignore */ }
        return { id: row.id as string, name: row.name as string, category: (row.category as string) ?? null, cost: (row.cost as string) ?? null, statLine };
      });
  } else if (step?.kind === "spells") {
    const r = await getDb().execute({
      sql: "SELECT id, name, level, school FROM spells WHERE campaign_id IS NULL AND level <= ? ORDER BY level, name",
      args: [step.maxLevel],
    });
    spellRows = r.rows.map((row) => ({ id: row.id as string, name: row.name as string, level: Number(row.level ?? 0), school: (row.school as string) ?? null }));
  }

  const stepAnswer = step ? answers[step.id] : undefined;
  const answerWithIndex = answerAction.bind(null, stepIndex);
  const rollWithIndex = rollAction.bind(null, stepIndex);

  return (
    <div className="max-w-3xl mx-auto">
      <SectionHeading eyebrow={`Step ${Math.min(stepIndex + 1, total + 1)} of ${total + 1}`} title={step ? step.title : "Review & Submit"} />

      {/* progress rail */}
      <div className="flex flex-wrap justify-center gap-2 mb-8 text-xs">
        {bp.steps.map((s, i) => (
          <Link key={s.id} href={`/me/create?step=${i}`} className={`rounded-full px-3 py-1 border ${i === stepIndex ? "bg-gold/90 text-ink border-gold" : answers[s.id] ? "border-gold/40 text-gold" : "border-gold/20 text-parchment/40"}`}>
            {answers[s.id] ? "✓ " : ""}{s.title}
          </Link>
        ))}
        <Link href={`/me/create?step=${total}`} className={`rounded-full px-3 py-1 border ${stepIndex === total ? "bg-gold/90 text-ink border-gold" : "border-gold/20 text-parchment/40"}`}>Review</Link>
      </div>

      {rejectedNote !== null && (
        <p className="rounded-lg border border-blood/40 bg-blood/10 px-4 py-3 text-sm text-parchment/80 mb-6">
          <span className="font-semibold text-blood">The DM sent this back:</span> {rejectedNote || "Revise and resubmit."}
        </p>
      )}
      {searchParams.error && <p className="text-sm text-blood mb-4 text-center">{searchParams.error}</p>}

      {step ? (
        <div className="rounded-lg border border-gold/20 p-5 shadow-card">
          {step.kind === "stats" && (
            <div className="space-y-4">
              {step.method.kind === "rolled" && (
                <form action={rollWithIndex}>
                  <button type="submit" className="rounded-full border border-gold/40 text-gold px-4 py-2 text-sm hover:bg-gold/10">
                    🎲 {stepAnswer?.kind === "stats" && stepAnswer.rolled ? "Re-roll all six" : "Roll your stats"}
                  </button>
                </form>
              )}
              <form action={answerWithIndex} className="space-y-4">
                <StatFields step={step} answer={stepAnswer} />
                <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold">Save &amp; Continue</button>
              </form>
            </div>
          )}
          {step.kind === "choice" && (
            <form action={answerWithIndex} className="space-y-3">
              {step.prompt && <p className="text-parchment/60 italic text-sm">{step.prompt}</p>}
              <div className="space-y-2">
                {step.options.map((o) => (
                  <label key={o.id} className="flex items-start gap-3 rounded-lg border border-gold/15 p-3 hover:bg-void/40 cursor-pointer">
                    <input type="radio" name="optionId" value={o.id} defaultChecked={stepAnswer?.kind === "choice" && stepAnswer.optionId === o.id} className="accent-[#6e1f14] mt-1" />
                    <span>
                      <span className="text-parchment font-semibold">{o.name}</span>
                      {o.statEffects && Object.keys(o.statEffects).length > 0 && (
                        <span className="ml-2 text-xs text-gold">{Object.entries(o.statEffects).map(([k, v]) => `${v! > 0 ? "+" : ""}${v} ${k.toUpperCase()}`).join(", ")}</span>
                      )}
                      {o.description && <span className="block text-sm text-parchment/60">{o.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold">Save &amp; Continue</button>
            </form>
          )}
          {step.kind === "equipment" && (
            <form action={answerWithIndex} className="space-y-3">
              <p className="text-sm text-parchment/60">Budget: <span className="text-gold">{step.goldBudget} gp</span> · up to {step.maxItems} items. Unspent gold becomes your starting coin.</p>
              <div className="max-h-96 overflow-y-auto rounded-lg border border-gold/15 divide-y divide-gold/10">
                {equipmentRows.map((it) => (
                  <label key={it.id} className="flex items-center gap-3 px-3 py-2 hover:bg-void/40 cursor-pointer text-sm">
                    <input type="checkbox" name="itemId" value={it.id} defaultChecked={stepAnswer?.kind === "equipment" && stepAnswer.itemIds.includes(it.id)} className="accent-[#6e1f14]" />
                    <span className="flex-1 text-parchment">{it.name}</span>
                    <span className="text-parchment/40 text-xs">{it.statLine}</span>
                    <span className="text-parchment/60 w-16 text-right">{it.cost ?? "—"}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold">Save &amp; Continue</button>
            </form>
          )}
          {step.kind === "spells" && (
            <form action={answerWithIndex} className="space-y-3">
              <p className="text-sm text-parchment/60">Choose up to <span className="text-gold">{step.maxSpells}</span> spells of level {step.maxLevel} or lower.</p>
              <div className="max-h-96 overflow-y-auto rounded-lg border border-gold/15 divide-y divide-gold/10">
                {spellRows.map((sp) => (
                  <label key={sp.id} className="flex items-center gap-3 px-3 py-2 hover:bg-void/40 cursor-pointer text-sm">
                    <input type="checkbox" name="spellId" value={sp.id} defaultChecked={stepAnswer?.kind === "spells" && stepAnswer.spellIds.includes(sp.id)} className="accent-[#6e1f14]" />
                    <span className="flex-1 text-parchment">{sp.name}</span>
                    <span className="text-parchment/40 text-xs">{sp.level === 0 ? "Cantrip" : `Level ${sp.level}`}{sp.school ? ` · ${sp.school}` : ""}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold">Save &amp; Continue</button>
            </form>
          )}
          {step.kind === "text" && (
            <form action={answerWithIndex} className="space-y-4">
              {step.prompts.map((p) => (
                <label key={p.id} className="block">
                  <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{p.label}{p.required && <span className="text-blood"> *</span>}</span>
                  {p.long ? (
                    <textarea name={`prompt_${p.id}`} rows={4} defaultValue={stepAnswer?.kind === "text" ? stepAnswer.values[p.id] ?? "" : ""} className={inputCls} />
                  ) : (
                    <input type="text" name={`prompt_${p.id}`} defaultValue={stepAnswer?.kind === "text" ? stepAnswer.values[p.id] ?? "" : ""} className={inputCls} />
                  )}
                </label>
              ))}
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-6 py-2 text-sm font-medium hover:bg-gold">Save &amp; Continue</button>
            </form>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-gold/20 p-5 shadow-card text-center space-y-4">
          {firstUnanswered !== -1 ? (
            <p className="text-parchment/60">
              Some steps are unfinished - <Link href={`/me/create?step=${firstUnanswered}`} className="text-gold hover:underline">continue with &quot;{bp.steps[firstUnanswered].title}&quot;</Link>.
            </p>
          ) : (
            <>
              <p className="text-parchment/70">Every step is complete. Submit your character to the DM for approval - after that, only the DM can unlock it for changes.</p>
              <form action={submitAction}>
                <button type="submit" className="rounded-full bg-gold/90 text-ink px-8 py-3 font-medium hover:bg-gold">Submit to the DM</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
