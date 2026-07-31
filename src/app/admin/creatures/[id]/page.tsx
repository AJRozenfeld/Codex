import { notFound, redirect } from "next/navigation";
import {
  getCreature,
  getLibraryCreature,
  upsertCreature,
  upsertLibraryCreature,
  deleteCreature,
  deleteLibraryCreature,
  copyLibraryCreatureToCampaign,
} from "@/lib/creature-queries";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { getMasterSession } from "@/lib/auth";
import { Field, TextArea, FormActions } from "@/components/AdminForm";
import { CreatureStatBlockForm } from "@/components/CreatureStatBlockForm";
import type { Creature, MonsterStatBlock } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Platform Bestiary (2026-07-27): a creature here is either the campaign's
// own (fully editable) or a shared platform-library row. Library rows are
// read-only for DMs - they get a "Copy to Campaign & Edit" action instead -
// and editable only under an active master session (library curation).
// Every mutating action re-checks which world it's in server-side; the
// campaign-scoped queries can't touch NULL-campaign rows by construction.
// ---------------------------------------------------------------------------

function parseBasics(formData: FormData) {
  const hpRaw = String(formData.get("hp") ?? "").trim();
  const acRaw = String(formData.get("ac") ?? "").trim();
  const initBonusRaw = String(formData.get("initBonus") ?? "").trim();
  return {
    hp: hpRaw ? Number(hpRaw) : null,
    ac: acRaw ? Number(acRaw) : null,
    initBonus: initBonusRaw ? Number(initBonusRaw) : 0,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    portraitPath: String(formData.get("portraitPath") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || null,
  };
}

async function loadForEdit(id: string): Promise<{ creature: Creature | null; isLibrary: boolean; isMaster: boolean }> {
  const campaignId = await getCurrentCampaignId();
  const creature = await getCreature(campaignId, id);
  const master = await getMasterSession();
  return { creature, isLibrary: creature?.campaignId === null, isMaster: !!master.isMaster };
}

async function updateBasicsAction(id: string, formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { creature, isLibrary, isMaster } = await loadForEdit(id);
  if (!creature) return;
  const input = { name, ...parseBasics(formData), statBlock: creature.statBlock };
  if (isLibrary) {
    if (!isMaster) return;
    await upsertLibraryCreature(input, id);
  } else {
    await upsertCreature(creature.campaignId as string, input, id);
  }
  redirect(`/admin/creatures/${id}`);
}

async function updateStatBlockAction(id: string, formData: FormData) {
  "use server";
  const { creature, isLibrary, isMaster } = await loadForEdit(id);
  if (!creature) return;
  const raw = String(formData.get("statBlockData") ?? "{}");
  let statBlock: Partial<MonsterStatBlock>;
  try {
    statBlock = JSON.parse(raw);
  } catch {
    return;
  }
  const input = {
    name: creature.name,
    hp: creature.hp,
    ac: creature.ac,
    initBonus: creature.initBonus,
    notes: creature.notes ?? undefined,
    portraitPath: creature.portraitPath,
    source: creature.source,
    statBlock,
  };
  if (isLibrary) {
    if (!isMaster) return;
    await upsertLibraryCreature(input, id);
  } else {
    await upsertCreature(creature.campaignId as string, input, id);
  }
  redirect(`/admin/creatures/${id}`);
}

async function deleteAction(id: string) {
  "use server";
  const { creature, isLibrary, isMaster } = await loadForEdit(id);
  if (!creature) return;
  if (isLibrary) {
    if (!isMaster) return;
    await deleteLibraryCreature(id);
  } else {
    await deleteCreature(creature.campaignId as string, id);
  }
  redirect("/admin/creatures");
}

async function copyAction(id: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const src = await getLibraryCreature(id);
  if (!src) return;
  const newId = await copyLibraryCreatureToCampaign(campaignId, id);
  redirect(newId ? `/admin/creatures/${newId}` : "/admin/creatures");
}

function Section({ title, entries }: { title: string; entries: { name: string; text: string }[] }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div>
      <h3 className="font-display text-lg text-gold mb-2">{title}</h3>
      <ul className="space-y-2">
        {entries.map((e, i) => (
          <li key={i} className="text-sm text-parchment/80">
            <span className="font-semibold text-parchment">{e.name}.</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatBlockReadOnly({ creature }: { creature: Creature }) {
  const sb = creature.statBlock;
  const abilities: [string, number][] = [
    ["STR", sb.abilityScores.str],
    ["DEX", sb.abilityScores.dex],
    ["CON", sb.abilityScores.con],
    ["INT", sb.abilityScores.int],
    ["WIS", sb.abilityScores.wis],
    ["CHA", sb.abilityScores.cha],
  ];
  const mod = (v: number) => {
    const m = Math.floor((v - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  };
  const line = (label: string, value: string | null | undefined) =>
    value ? (
      <p className="text-sm text-parchment/80">
        <span className="font-semibold text-parchment">{label}.</span> {value}
      </p>
    ) : null;
  return (
    <div className="rounded-lg border border-gold/20 p-5 space-y-5 shadow-card">
      <div>
        <p className="text-sm italic text-parchment/60">
          {[sb.size, sb.creatureType].filter(Boolean).join(" ")}
          {sb.alignment ? `, ${sb.alignment}` : ""}
        </p>
        <p className="text-sm text-parchment/80 mt-2">
          <span className="font-semibold text-parchment">AC</span> {creature.ac ?? "\u2014"}{" "}
          <span className="font-semibold text-parchment ml-3">HP</span> {creature.hp ?? "\u2014"}{" "}
          <span className="font-semibold text-parchment ml-3">Speed</span> {sb.speed || "\u2014"}
        </p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        {abilities.map(([k, v]) => (
          <div key={k} className="rounded border border-gold/15 py-2">
            <div className="text-xs uppercase tracking-widest text-ember/80">{k}</div>
            <div className="text-parchment font-semibold">{v}</div>
            <div className="text-xs text-parchment/50">{mod(v)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {line("Saving Throws", sb.savingThrows)}
        {line("Skills", sb.skills)}
        {line("Vulnerabilities", sb.damageVulnerabilities)}
        {line("Resistances", sb.damageResistances)}
        {line("Damage Immunities", sb.damageImmunities)}
        {line("Condition Immunities", sb.conditionImmunities)}
        {line("Senses", sb.senses)}
        {line("Languages", sb.languages)}
        {line("Challenge", sb.challengeRating ? `${sb.challengeRating} (${sb.xp} XP)` : null)}
      </div>
      <Section title="Traits" entries={sb.traits} />
      <Section title="Actions" entries={sb.actions} />
      <Section title="Bonus Actions" entries={sb.bonusActions} />
      <Section title="Reactions" entries={sb.reactions} />
      <Section title="Legendary Actions" entries={sb.legendaryActions} />
    </div>
  );
}

export default async function AdminCreatureEditPage({ params }: { params: { id: string } }) {
  const campaignId = await getCurrentCampaignId();
  const creature = await getCreature(campaignId, params.id);
  if (!creature) notFound();
  const isLibrary = creature.campaignId === null;
  const master = await getMasterSession();
  const canEdit = !isLibrary || !!master.isMaster;

  const updateBasics = updateBasicsAction.bind(null, params.id);
  const updateStatBlock = updateStatBlockAction.bind(null, params.id);
  const del = deleteAction.bind(null, params.id);
  const copy = copyAction.bind(null, params.id);

  if (!canEdit) {
    // A DM viewing a shared library monster: the full stat block, read-only,
    // with one honest way to make it theirs.
    return (
      <div className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl text-gold mb-1">{creature.name}</h1>
            <p className="text-xs uppercase tracking-widest text-ember/80">
              Platform Library{creature.source ? ` \u00b7 ${creature.source}` : ""}
            </p>
          </div>
          <form action={copy}>
            <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
              Copy to Campaign &amp; Edit
            </button>
          </form>
        </div>
        <p className="text-sm text-parchment/50">
          Library monsters are shared with every DM and can&apos;t be edited directly - copy one into your
          campaign to customize your own version.
        </p>
        <StatBlockReadOnly creature={creature} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-10">
      {isLibrary && (
        <p className="rounded-lg border border-gold/30 bg-void/40 px-4 py-3 text-sm text-parchment/80">
          <span className="font-semibold text-gold">Master console:</span> you are editing a{" "}
          <span className="font-semibold">platform library</span> monster - changes are visible to every DM.
        </p>
      )}
      <div>
        <h1 className="font-display text-2xl text-gold mb-6">Edit Creature: {creature.name}</h1>
        <form action={updateBasics} className="space-y-4 rounded-lg border border-gold/15 p-4">
          <Field label="Name" name="name" defaultValue={creature.name} required />
          <div className="grid grid-cols-3 gap-3">
            <Field label="HP" name="hp" type="number" defaultValue={creature.hp !== null ? String(creature.hp) : ""} />
            <Field label="AC" name="ac" type="number" defaultValue={creature.ac !== null ? String(creature.ac) : ""} />
            <Field label="Initiative Bonus" name="initBonus" type="number" defaultValue={String(creature.initBonus)} />
          </div>
          <p className="text-xs text-parchment/40 -mt-1">
            These three feed Scenes&apos; auto-rolled initiative directly - keep HP/AC/init bonus in sync with the ability
            scores below if you change them (init bonus is usually the Dex modifier).
          </p>
          <Field label="Portrait URL" name="portraitPath" defaultValue={creature.portraitPath ?? ""} placeholder="/images/monsters/goblin.png" />
          <Field label="Source / Attribution" name="source" defaultValue={creature.source ?? ""} placeholder="e.g. SRD 5.1 (CC BY 4.0), or Homebrew" />
          <TextArea label="DM Notes (private reminders, distinct from the stat block)" name="notes" defaultValue={creature.notes} rows={3} />
          <FormActions deleteAction={del} />
        </form>
      </div>

      <div>
        <h2 className="font-display text-xl text-gold mb-4">Stat Block</h2>
        <CreatureStatBlockForm initialData={creature.statBlock} saveAction={updateStatBlock} submitLabel="Save Stat Block" />
      </div>
    </div>
  );
}
