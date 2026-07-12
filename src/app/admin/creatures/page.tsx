import Link from "next/link";
import { redirect } from "next/navigation";
import { listCreatures, upsertCreature } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { Field, TextArea } from "@/components/AdminForm";

export const dynamic = "force-dynamic";

async function createAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const hpRaw = String(formData.get("hp") ?? "").trim();
  const acRaw = String(formData.get("ac") ?? "").trim();
  const initBonusRaw = String(formData.get("initBonus") ?? "").trim();
  const id = await upsertCreature(campaignId, {
    name,
    hp: hpRaw ? Number(hpRaw) : null,
    ac: acRaw ? Number(acRaw) : null,
    initBonus: initBonusRaw ? Number(initBonusRaw) : 0,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  redirect(`/admin/creatures/${id}`);
}

export default async function AdminCreaturesPage() {
  const campaignId = await getCurrentCampaignId();
  const creatures = await listCreatures(campaignId);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-gold">Creature Library</h1>
        <p className="text-sm text-parchment/40 mt-1">
          Stat block a monster once (HP, AC, initiative bonus), then reuse it across as many{" "}
          <Link href="/admin/scenes" className="text-gold hover:underline">Scenes</Link>{" "}
          as you like without retyping it. Scenes can also add one-off creatures that never touch this library.
        </p>
      </div>

      <form action={createAction} className="mb-8 space-y-4 rounded-lg border border-gold/15 p-4 max-w-xl">
        <h2 className="font-display text-lg text-gold">New Creature</h2>
        <Field label="Name" name="name" required />
        <div className="grid grid-cols-3 gap-3">
          <Field label="HP" name="hp" type="number" />
          <Field label="AC" name="ac" type="number" />
          <Field label="Initiative Bonus" name="initBonus" type="number" defaultValue="0" />
        </div>
        <TextArea label="Notes (attacks, abilities, anything worth having on hand)" name="notes" rows={3} />
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
          + Add Creature
        </button>
      </form>

      <div className="rounded-lg border border-gold/15 overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-void/70 text-ember/70 text-left text-xs uppercase tracking-widest border-b border-gold/15">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">HP</th>
              <th className="px-4 py-2">AC</th>
              <th className="px-4 py-2">Init Bonus</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {creatures.map((c) => (
              <tr key={c.id} className="border-t border-gold/10 hover:bg-void/30 transition-colors">
                <td className="px-4 py-2 text-parchment">{c.name}</td>
                <td className="px-4 py-2 text-parchment/50">{c.hp ?? ""}</td>
                <td className="px-4 py-2 text-parchment/50">{c.ac ?? ""}</td>
                <td className="px-4 py-2 text-parchment/50">{c.initBonus >= 0 ? `+${c.initBonus}` : c.initBonus}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/creatures/${c.id}`} className="text-gold hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
            {creatures.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-parchment/40">No creatures yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
