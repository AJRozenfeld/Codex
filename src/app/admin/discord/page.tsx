import { redirect } from "next/navigation";
import {
  getGuildLinkForCampaign,
  generateCampaignLinkCode,
  unlinkGuild,
  getDiscordSettings,
  updateDiscordMessageSettings,
  listGuildChannels,
  listCustomCommands,
  createCustomCommand,
  updateCustomCommand,
  deleteCustomCommand,
  addCommandButton,
  updateCommandButton,
  removeCommandButton,
  moveCommandButton,
  listCustomMasks,
  upsertCustomMask,
  deleteCustomMask,
  sanitizeCommandAction,
} from "@/lib/discord-io";
import { getCurrentCampaignId } from "@/lib/campaign-queries";
import { adminGetCharacters, adminGetLocations, adminGetFactions, adminGetArtifacts } from "@/lib/admin-queries";
import { listCreatures } from "@/lib/creature-queries";
import { resolveSheetTemplateForCampaign } from "@/lib/sheet-template-queries";
import { DiscordCommandsPanel, type CommandEditorOptions } from "@/components/DiscordCommandsPanel";
import type { CommandButtonStyle } from "@/lib/types";

export const dynamic = "force-dynamic";

// The bot's public application id - overridable via env so a different bot
// (e.g. a test instance) can be pointed at without a code change. Client ids
// are public by design (they appear in every invite URL), so the fallback
// being in source is fine; the BOT TOKEN is the secret, and it never goes
// anywhere near the website.
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "1523705676126355486";
// Exactly the permissions discord-bot/README.md step 3 asks for: View
// Channels + Send Messages + Manage Messages + Manage Webhooks + Connect +
// Speak. Discord shows this as a pre-checked list on the invite screen.
const BOT_INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=540027904`;

const sectionCls = "rounded-lg border border-gold/20 bg-void p-4";
const headingCls = "font-display text-lg text-gold mb-1";
const subCls = "text-xs text-parchment/40 mb-4";
const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm focus:outline-none focus:border-gold/70";
const labelCls = "block text-[10px] uppercase tracking-widest text-ember/80 mb-1";

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

/** All the config actions redirect back here; {ok:false} results surface as
 *  ?error= so the DM sees why a save refused instead of a silent no-op. */
function done(error?: string): never {
  redirect(error ? `/admin/discord?error=${encodeURIComponent(error)}` : "/admin/discord");
}

async function saveMessageSettingsAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const rollChannelRaw = String(formData.get("rollChannelId") ?? "");
  await updateDiscordMessageSettings(campaignId, {
    notifyReveals: formData.get("notifyReveals") === "on",
    rollChannelId: rollChannelRaw && rollChannelRaw !== "__auto" ? rollChannelRaw : null,
  });
  done();
}

async function createCommandAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const r = await createCustomCommand(campaignId, String(formData.get("name") ?? ""), String(formData.get("description") ?? ""));
  done(r.ok ? undefined : r.error);
}

async function saveCommandAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const r = await updateCustomCommand(campaignId, String(formData.get("commandId") ?? ""), {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    enabled: formData.get("enabled") === "on",
  });
  done(r.ok ? undefined : r.error);
}

async function deleteCommandAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteCustomCommand(campaignId, String(formData.get("commandId") ?? ""));
  done();
}

function parseButtonForm(formData: FormData) {
  const styleRaw = String(formData.get("style") ?? "secondary");
  const style: CommandButtonStyle = ["primary", "secondary", "success", "danger"].includes(styleRaw)
    ? (styleRaw as CommandButtonStyle)
    : "secondary";
  let action = null;
  try {
    action = sanitizeCommandAction(JSON.parse(String(formData.get("actionJson") ?? "{}")));
  } catch {
    action = null;
  }
  return {
    commandId: String(formData.get("commandId") ?? ""),
    buttonId: String(formData.get("buttonId") ?? ""),
    label: String(formData.get("label") ?? ""),
    style,
    action,
  };
}

async function addButtonAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const b = parseButtonForm(formData);
  if (!b.action) done("That button's action is incomplete - fill in every field before adding it.");
  const r = await addCommandButton(campaignId, b.commandId, b.label, b.style, b.action);
  done(r.ok ? undefined : r.error);
}

async function saveButtonAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const b = parseButtonForm(formData);
  if (!b.action) done("That button's action is incomplete - fill in every field before saving it.");
  const r = await updateCommandButton(campaignId, b.commandId, b.buttonId, b.label, b.style, b.action);
  done(r.ok ? undefined : r.error);
}

async function deleteButtonAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await removeCommandButton(campaignId, String(formData.get("commandId") ?? ""), String(formData.get("buttonId") ?? ""));
  done();
}

async function moveButtonAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const direction = formData.get("direction") === "up" ? "up" : "down";
  await moveCommandButton(campaignId, String(formData.get("commandId") ?? ""), String(formData.get("buttonId") ?? ""), direction);
  done();
}

async function saveMaskAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const id = String(formData.get("maskId") ?? "") || undefined;
  const file = formData.get("avatar");
  const r = await upsertCustomMask(
    campaignId,
    {
      mask: String(formData.get("mask") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      avatarFile: file instanceof File ? file : null,
    },
    id
  );
  done(r.ok ? undefined : r.error);
}

async function deleteMaskAction(formData: FormData) {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await deleteCustomMask(campaignId, String(formData.get("maskId") ?? ""));
  done();
}

export default async function AdminDiscordPage({ searchParams }: { searchParams: { code?: string; error?: string } }) {
  const campaignId = await getCurrentCampaignId();
  const guildLink = await getGuildLinkForCampaign(campaignId);
  const unlink = guildLink ? unlinkAction.bind(null, guildLink.guildId) : undefined;

  // Config data only matters once a guild is linked.
  const [settings, channels, commands, masks] = guildLink
    ? await Promise.all([
        getDiscordSettings(campaignId),
        listGuildChannels(campaignId),
        listCustomCommands(campaignId),
        listCustomMasks(campaignId),
      ])
    : [null, [], [], []];

  let options: CommandEditorOptions | null = null;
  if (guildLink) {
    const [characters, locations, factions, artifacts, creatures, template] = await Promise.all([
      adminGetCharacters(campaignId),
      adminGetLocations(campaignId),
      adminGetFactions(campaignId),
      adminGetArtifacts(campaignId),
      listCreatures(campaignId),
      resolveSheetTemplateForCampaign(campaignId),
    ]);
    options = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      locations: locations.map((l) => ({ id: l.id, name: l.name })),
      factions: factions.map((f) => ({ id: f.id, name: f.name })),
      artifacts: artifacts.map((a) => ({ id: a.id, name: a.name })),
      creatures: creatures.map((c) => ({ id: c.id, name: c.name })),
      variables: template.def.variables.map((v) => ({ key: v.key, label: v.label, group: v.group })),
    };
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl text-gold mb-1">Discord Bot</h1>
        <p className="text-sm text-parchment/40">
          Link one Discord server to this campaign so the bot&apos;s masks, panel, and music library all resolve here.
        </p>
      </div>

      {searchParams?.error && (
        <div className="rounded-lg border border-blood/50 bg-void p-3 text-sm text-blood">{searchParams.error}</div>
      )}

      <div className={`${sectionCls} flex items-center justify-between gap-4 flex-wrap`}>
        <p className="text-sm text-parchment/60">
          Not in your server yet? This opens Discord&apos;s own panel where you pick which server to add the bot to.
        </p>
        <a
          href={BOT_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-gold/40 text-gold px-5 py-2 text-sm font-medium hover:bg-gold/10 hover:border-gold/70 transition-colors whitespace-nowrap"
        >
          Invite Bot to a Server
        </a>
      </div>

      {guildLink ? (
        <div className={`${sectionCls} space-y-3`}>
          <p className="text-sm text-parchment/70">
            Linked to server <code className="text-gold/80">{guildLink.guildId}</code>
          </p>
          <form action={unlink}>
            <button type="submit" className="text-sm text-blood hover:underline">Unlink this server</button>
          </form>
        </div>
      ) : searchParams?.code ? (
        <div className={sectionCls}>
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

      {guildLink && settings && options && (
        <>
          {/* ---------------- Messages ---------------- */}
          <section className={sectionCls}>
            <h2 className={headingCls}>Messages</h2>
            <p className={subCls}>
              Where the bot speaks, and to whom. Masked <code>*commands*</code> always answer in the channel they were
              typed in - these settings only steer the bot&apos;s own messages.
            </p>
            <form action={saveMessageSettingsAction} className="space-y-4">
              <label className="block max-w-sm">
                <span className={labelCls}>Website rolls post to</span>
                <select className={inputCls} name="rollChannelId" defaultValue={settings.rollChannelId ?? "__auto"}>
                  <option value="__auto">Auto - wherever masks last spoke</option>
                  {channels.map((ch) => (
                    <option key={ch.channelId} value={ch.channelId}>
                      #{ch.name}
                    </option>
                  ))}
                </select>
                {channels.length === 0 && (
                  <span className="block text-[11px] text-parchment/40 mt-1">
                    The channel list fills in a minute or two after the updated bot comes online in your server.
                  </span>
                )}
              </label>
              <label className="flex items-start gap-2 text-sm text-parchment/70 max-w-xl">
                <input type="checkbox" className="accent-gold mt-0.5" name="notifyReveals" defaultChecked={settings.notifyReveals} />
                <span>
                  DM players when new entries are revealed to them
                  <span className="block text-[11px] text-parchment/40">
                    Reveals within a couple of minutes arrive as one tidy digest per player, not a flood - and only
                    players who linked their Discord account (<code>/link</code> from their profile page) can be reached.
                  </span>
                </span>
              </label>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-xs font-medium hover:bg-gold">
                Save Message Settings
              </button>
            </form>
          </section>

          {/* ---------------- Custom commands ---------------- */}
          <section className={sectionCls}>
            <h2 className={headingCls}>Custom Commands</h2>
            <p className={subCls}>
              Define your own slash commands for the linked server. Each opens a panel of buttons only you can see
              (like <code>/panel music</code>); pressing a button posts to the channel - an entity introduction, custom
              text, a status card, or a dice roll resolved against a character&apos;s sheet using your campaign&apos;s own sheet
              system, so custom stats roll just as well as the classic six. Changes reach Discord within a minute.
            </p>
            <DiscordCommandsPanel
              commands={commands}
              options={options}
              actions={{
                createCommand: createCommandAction,
                saveCommand: saveCommandAction,
                deleteCommand: deleteCommandAction,
                addButton: addButtonAction,
                saveButton: saveButtonAction,
                deleteButton: deleteButtonAction,
                moveButton: moveButtonAction,
              }}
            />
          </section>

          {/* ---------------- Custom masks ---------------- */}
          <section className={sectionCls}>
            <h2 className={headingCls}>Custom Masks</h2>
            <p className={subCls}>
              Voices that belong to no character - a town crier, a mysterious narrator, the tavern crowd. Only you (the
              DM) can speak through them with <code>[[mask]]: message</code>, and they never execute{" "}
              <code>*commands*</code> like <code>*roll strength*</code> or <code>*init*</code>.
            </p>

            <form action={saveMaskAction} className="grid sm:grid-cols-[10rem_1fr_1fr_auto] gap-2 items-end mb-4">
              <label className="block">
                <span className={labelCls}>Mask word</span>
                <input className={inputCls} name="mask" placeholder="crier" required />
              </label>
              <label className="block">
                <span className={labelCls}>Display name</span>
                <input className={inputCls} name="displayName" placeholder="Town Crier of Camor" required />
              </label>
              <label className="block">
                <span className={labelCls}>Picture (optional)</span>
                <input type="file" name="avatar" accept="image/*" className="block w-full text-xs text-parchment/60 file:mr-2 file:rounded-full file:border file:border-gold/40 file:bg-transparent file:px-3 file:py-1 file:text-xs file:text-gold" />
              </label>
              <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-xs font-medium hover:bg-gold">
                + Add Mask
              </button>
            </form>

            <div className="space-y-2">
              {masks.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-gold/15 bg-void/40 px-3 py-2">
                  {m.avatarPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatarPath} alt={m.displayName} className="h-8 w-8 rounded-full object-cover border border-gold/30" />
                  ) : (
                    <span className="h-8 w-8 rounded-full border border-gold/30 bg-void flex items-center justify-center text-gold/50 text-xs">
                      {m.displayName.charAt(0)}
                    </span>
                  )}
                  <code className="text-gold/80 text-sm">[[{m.mask}]]</code>
                  <span className="flex-1 text-sm text-parchment/75">{m.displayName}</span>
                  <form action={saveMaskAction} className="inline-flex items-end gap-2">
                    <input type="hidden" name="maskId" value={m.id} />
                    <input className="w-24 rounded bg-void border border-gold/30 px-2 py-1 text-parchment text-xs" name="mask" defaultValue={m.mask} title="Mask word" />
                    <input className="w-36 rounded bg-void border border-gold/30 px-2 py-1 text-parchment text-xs" name="displayName" defaultValue={m.displayName} title="Display name" />
                    <input type="file" name="avatar" accept="image/*" className="w-40 text-[10px] text-parchment/50 file:mr-1 file:rounded-full file:border file:border-gold/40 file:bg-transparent file:px-2 file:py-0.5 file:text-[10px] file:text-gold" title="Replace picture" />
                    <button type="submit" className="text-xs text-gold/80 hover:text-gold hover:underline">Save</button>
                  </form>
                  <form action={deleteMaskAction}>
                    <input type="hidden" name="maskId" value={m.id} />
                    <button type="submit" className="text-xs text-blood hover:underline">Remove</button>
                  </form>
                </div>
              ))}
              {masks.length === 0 && <p className="text-xs text-parchment/40">No custom masks yet.</p>}
            </div>
          </section>
        </>
      )}

      <div className="pt-2 border-t border-gold/20 text-sm text-parchment/50 space-y-2">
        <p>Once linked, in that server:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <code className="text-gold/80">[[mask]]: message</code> speaks/acts as the character with that mask -
            set NPC masks from each character&apos;s admin page, players set their own from{" "}
            <code className="text-gold/80">/me/profile</code>, and your custom masks live above.
          </li>
          <li>
            <code className="text-gold/80">[[mask]]: *roll strength*</code> rolls using that character&apos;s sheet -
            works for any ability or skill. (Custom masks stay silent on commands, by design.)
          </li>
          <li>
            <code className="text-gold/80">/panel npcs</code>, <code className="text-gold/80">/panel locations</code>,{" "}
            <code className="text-gold/80">/panel music</code> browse your library right in Discord - plus every custom
            command you define above.
          </li>
        </ul>
      </div>
    </div>
  );
}
