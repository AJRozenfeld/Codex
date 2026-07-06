import { redirect } from "next/navigation";
import { getGuildLinkForCampaign, generateCampaignLinkCode, unlinkGuild } from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";

export const dynamic = "force-dynamic";

async function generateCodeAction() {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const { code } = await generateCampaignLinkCode(campaignId);
  redirect(`/admin/discord?code=${code}`);
}

async function unlinkAction(guildId: string) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await unlinkGuild(campaignId, guildId);
  redirect("/admin/discord");
}

export default async function AdminDiscordPage({ searchParams }: { searchParams: { code?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const guildLink = await getGuildLinkForCampaign(campaignId);
  const unlink = guildLink ? unlinkAction.bind(null, guildLink.guildId) : undefined;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-gold mb-1">Discord Bot</h1>
      <p className="text-sm text-parchment/40 mb-6">
        Link one Discord server to this campaign so the bot's masks, panel, and music library all resolve here. See{" "}
        <code className="text-gold/80">discord-bot/README.md</code> for how to invite the bot itself.
      </p>

      {guildLink ? (
        <div className="rounded-lg border border-gold/30 bg-void p-4 space-y-3">
          <p className="text-sm text-parchment/70">
            Linked to server <code className="text-gold/80">{guildLink.guildId}</code>
          </p>
          <form action={unlink}>
            <button type="submit" className="text-sm text-blood hover:underline">Unlink this server</button>
          </form>
        </div>
      ) : searchParams?.code ? (
        <div className="rounded-lg border border-gold/30 bg-void p-4">
          <p className="text-sm text-parchment/60 mb-2">In the Discord server (as an admin), run:</p>
          <code className="block text-gold text-lg tracking-widest">/link code:{searchParams.code}</code>
          <p className="text-xs text-parchment/40 mt-2">This code expires in 15 minutes.</p>
        </div>
      ) : (
        <form action={generateCodeAction}>
          <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
            Generate Server Link Code
          </button>
        </form>
      )}

      <div className="mt-8 pt-6 border-t border-gold/20 text-sm text-parchment/50 space-y-2">
        <p>Once linked, in that server:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <code className="text-gold/80">[[mask]]: message</code> speaks/acts as the character with that mask -
            set NPC masks from each character's admin page, players set their own from{" "}
            <code className="text-gold/80">/me/profile</code>.
          </li>
          <li>
            <code className="text-gold/80">[[mask]]: *roll strength*</code> rolls using that character's sheet -
            works for any ability or skill.
          </li>
          <li>
            <code className="text-gold/80">/panel npcs</code>, <code className="text-gold/80">/panel locations</code>,{" "}
            <code className="text-gold/80">/panel music</code> browse your library right in Discord.
          </li>
        </ul>
      </div>
    </div>
  );
}
