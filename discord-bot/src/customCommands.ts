import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import {
  getCampaignIdForGuild,
  listCampaignBotConfigs,
  listEnabledCustomCommands,
  getCommandButtonForExecution,
  getCharacterById,
  getCharacterSheetData,
  getCampaignSheetTemplateRaw,
  getCreatureStatus,
  getCreatureForEmbed,
  getNamedEntity,
  replaceGuildChannels,
} from "./db.js";
import { computeActionRoll, type ActionRollSpec, type VariableResolver } from "./rolls.js";
import { SHEET_TEMPLATE_5E, resolveTemplateVariable, sanitizeSheetTemplate, type SheetTemplateDef } from "./sheet-engine.js";

// ---------------------------------------------------------------------------
// DM-defined custom commands (Discord config suite, 2026-08-06). The DM
// builds commands + buttons on the website (/admin/discord); this module:
//
//  1. SYNC LOOP - polls discord_settings.commands_version (bumped by every
//     website save) and re-registers each linked guild's slash commands via
//     the REST API. GUILD commands, never global: they propagate instantly
//     and stay scoped to the campaign's own server. The built-ins stay
//     globally registered (register-commands.ts) and are never touched here.
//  2. CHANNEL SNAPSHOT - refreshes guild_channels so the website's
//     "where do rolls post" dropdown shows real channel names.
//  3. EXECUTION - /command opens an ephemeral DM-only panel of buttons
//     (same feel as /panel music); pressing a button posts to the channel:
//     an entity embed, custom text, a status card, or a dice roll resolved
//     against the campaign's SHEET TEMPLATE (sheet-engine mirror), so a
//     custom system's stats roll exactly like the classic six.
// ---------------------------------------------------------------------------

const SYNC_POLL_MS = 30_000;
const CHANNELS_REFRESH_MS = 10 * 60_000;
const GOLD = 0xd97706;

/** Same DM-gate as the battle commands - Manage Server. */
function memberIsDm(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
  const member = interaction.member;
  return !!(
    member &&
    "permissions" in member &&
    typeof member.permissions !== "string" &&
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

async function campaignTemplate(campaignId: string): Promise<SheetTemplateDef> {
  const raw = await getCampaignSheetTemplateRaw(campaignId);
  if (!raw) return SHEET_TEMPLATE_5E;
  return sanitizeSheetTemplate(raw) ?? SHEET_TEMPLATE_5E;
}

// ---------------------------------------------------------------------------
// 1 + 2: the sync loop.
// ---------------------------------------------------------------------------

const knownVersions = new Map<string, number>(); // guildId -> last-registered commands_version
let lastChannelRefresh = 0;

async function registerGuildCommands(client: Client, guildId: string, campaignId: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = client.user?.id;
  if (!token || !clientId) return;
  const commands = await listEnabledCustomCommands(campaignId);
  const body = commands.map((c) =>
    new SlashCommandBuilder().setName(c.name).setDescription(c.description.slice(0, 100) || "A Codex panel").toJSON()
  );
  const rest = new REST({ version: "10" }).setToken(token);
  // PUT replaces the guild's whole command set - exactly what we want, since
  // custom commands are the ONLY guild-scoped commands this bot ever makes.
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
}

async function refreshChannelSnapshot(client: Client, guildId: string): Promise<void> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    const texts: { id: string; name: string; position: number }[] = [];
    for (const ch of channels.values()) {
      if (ch && ch.type === 0 /* GuildText */) {
        texts.push({ id: ch.id, name: ch.name, position: "position" in ch ? (ch.position ?? 0) : 0 });
      }
    }
    await replaceGuildChannels(guildId, texts);
  } catch (err) {
    console.error(`[commands] channel snapshot failed for guild ${guildId}:`, err);
  }
}

async function syncOnce(client: Client): Promise<void> {
  const configs = await listCampaignBotConfigs();
  const refreshChannels = Date.now() - lastChannelRefresh > CHANNELS_REFRESH_MS;
  if (refreshChannels) lastChannelRefresh = Date.now();
  for (const cfg of configs) {
    if (refreshChannels) await refreshChannelSnapshot(client, cfg.guildId);
    if (knownVersions.get(cfg.guildId) === cfg.commandsVersion) continue;
    try {
      await registerGuildCommands(client, cfg.guildId, cfg.campaignId);
      knownVersions.set(cfg.guildId, cfg.commandsVersion);
      console.log(`[commands] synced guild ${cfg.guildId} at version ${cfg.commandsVersion}`);
    } catch (err) {
      console.error(`[commands] sync failed for guild ${cfg.guildId}:`, err);
    }
  }
}

export function startCommandSync(client: Client): void {
  // First pass immediately on ready (also fills the channel snapshot), then poll.
  lastChannelRefresh = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncOnce(client);
    } catch (err) {
      console.error("[commands] sync cycle failed:", err);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, SYNC_POLL_MS);
  console.log(`Custom-command sync started (every ${SYNC_POLL_MS / 1000}s).`);
}

// ---------------------------------------------------------------------------
// 3: execution.
// ---------------------------------------------------------------------------

const BUTTON_STYLES: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** Handles a slash command that isn't one of the built-ins - true if it
 *  matched a custom command (so the router knows it was consumed). */
export async function handleCustomCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;
  const campaignId = await getCampaignIdForGuild(interaction.guildId);
  if (!campaignId) return false;
  const commands = await listEnabledCustomCommands(campaignId);
  const cmd = commands.find((c) => c.name === interaction.commandName);
  if (!cmd) return false;

  await interaction.deferReply({ ephemeral: true });
  if (!memberIsDm(interaction)) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can open this panel." });
    return true;
  }
  if (cmd.buttons.length === 0) {
    await interaction.editReply({ content: `/${cmd.name} has no buttons yet - add some on the website (Admin → Discord).` });
    return true;
  }
  // Discord: at most 5 rows of 5 buttons per message.
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < cmd.buttons.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      cmd.buttons.slice(i, i + 5).map((b) =>
        new ButtonBuilder()
          .setCustomId(`cc:${b.id}`)
          .setLabel(b.label.slice(0, 80))
          .setStyle(BUTTON_STYLES[b.style] ?? ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }
  await interaction.editReply({ content: `**/${cmd.name}** - press a button to post it to this channel:`, components: rows });
  return true;
}

export async function handleCustomButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("cc:")) return false;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guildId || !interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.editReply({ content: "This only works in a server text channel." });
    return true;
  }
  if (!memberIsDm(interaction)) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can press these." });
    return true;
  }
  const buttonId = interaction.customId.slice("cc:".length);
  const button = await getCommandButtonForExecution(buttonId);
  const campaignId = await getCampaignIdForGuild(interaction.guildId);
  if (!button || !campaignId || button.campaignId !== campaignId) {
    await interaction.editReply({ content: "That button no longer exists (the panel may be stale - rerun the command)." });
    return true;
  }
  const action = button.action;
  const channel = interaction.channel;

  try {
    if (action && action.kind === "text" && typeof action.text === "string" && action.text.trim()) {
      const embed = new EmbedBuilder().setColor(GOLD).setDescription(action.text.slice(0, 1800));
      if (typeof action.imageUrl === "string" && /^https?:\/\//i.test(action.imageUrl)) embed.setImage(action.imageUrl);
      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "Posted." });
      return true;
    }

    if (action && action.kind === "entity" && typeof action.entityId === "string") {
      const embed = await buildEntityEmbed(String(action.entityType), action.entityId);
      if (!embed) {
        await interaction.editReply({ content: "That entry no longer exists - edit the button on the website." });
        return true;
      }
      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "Posted." });
      return true;
    }

    if (action && action.kind === "status" && typeof action.targetId === "string") {
      const embed = await buildStatusEmbed(String(action.targetType), action.targetId);
      if (!embed) {
        await interaction.editReply({ content: "That target no longer exists - edit the button on the website." });
        return true;
      }
      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "Posted." });
      return true;
    }

    if (action && action.kind === "roll" && typeof action.characterId === "string") {
      const character = await getCharacterById(action.characterId);
      if (!character) {
        await interaction.editReply({ content: "That character no longer exists - edit the button on the website." });
        return true;
      }
      const sheet = await getCharacterSheetData(action.characterId);
      const template = await campaignTemplate(campaignId);
      // Template-aware resolution: the campaign's own variables (custom
      // systems included), not the hardcoded 5e set. First taste of Phase C.
      const resolve: VariableResolver = (s, key) => resolveTemplateVariable(template, s ?? {}, key);
      const spec: ActionRollSpec = {
        label: typeof action.label === "string" ? action.label : "Roll",
        count: typeof action.count === "number" || typeof action.count === "string" ? action.count : 1,
        die: typeof action.die === "number" || typeof action.die === "string" ? action.die : 20,
        modifiers: Array.isArray(action.modifiers)
          ? action.modifiers.filter((m): m is number | string => typeof m === "number" || typeof m === "string")
          : [],
      };
      const roll = computeActionRoll(sheet, spec, resolve);
      await channel.send(`🎲 **${character.name}** — ${roll.label}: **${roll.total}** (${roll.breakdown})`);
      await interaction.editReply({ content: "Rolled." });
      return true;
    }

    await interaction.editReply({ content: "This button's action is broken - edit it on the website." });
    return true;
  } catch (err) {
    console.error("[commands] button execution failed:", err);
    await interaction.editReply({ content: "Something went wrong posting that." }).catch(() => {});
    return true;
  }
}

async function buildEntityEmbed(entityType: string, entityId: string): Promise<EmbedBuilder | null> {
  if (entityType === "characters") {
    const character = await getCharacterById(entityId);
    if (!character) return null;
    const embed = new EmbedBuilder()
      .setColor(GOLD)
      .setTitle(character.name)
      .setDescription(character.summary || "*No summary yet.*");
    if (character.portraitPath) embed.setThumbnail(character.portraitPath);
    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (character.charClass) fields.push({ name: "Class", value: character.charClass, inline: true });
    if (character.status) fields.push({ name: "Status", value: character.status, inline: true });
    if (character.factionName) fields.push({ name: "Faction", value: character.factionName, inline: true });
    if (fields.length) embed.addFields(fields);
    return embed;
  }
  if (entityType === "creatures") {
    const c = await getCreatureForEmbed(entityId);
    if (!c) return null;
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(c.name).setDescription(c.description || "*A creature of the wilds.*");
    if (c.subtitle) embed.setFooter({ text: c.subtitle });
    if (c.imagePath && /^https?:\/\//i.test(c.imagePath)) embed.setThumbnail(c.imagePath);
    return embed;
  }
  if (entityType === "locations" || entityType === "factions" || entityType === "artifacts") {
    const e = await getNamedEntity(entityType, entityId);
    if (!e) return null;
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(e.name).setDescription(e.description.slice(0, 2000) || "*No description yet.*");
    if (e.subtitle) embed.setFooter({ text: e.subtitle });
    if (e.imagePath && /^https?:\/\//i.test(e.imagePath)) embed.setThumbnail(e.imagePath);
    return embed;
  }
  return null;
}

async function buildStatusEmbed(targetType: string, targetId: string): Promise<EmbedBuilder | null> {
  if (targetType === "creature") {
    const c = await getCreatureStatus(targetId);
    if (!c) return null;
    const embed = new EmbedBuilder()
      .setColor(0xc97b4a)
      .setTitle(`${c.name} — Status`)
      .addFields(
        { name: "HP", value: c.hp === null ? "—" : String(c.hp), inline: true },
        { name: "AC", value: c.ac === null ? "—" : String(c.ac), inline: true }
      );
    if (c.portraitPath && /^https?:\/\//i.test(c.portraitPath)) embed.setThumbnail(c.portraitPath);
    return embed;
  }
  const character = await getCharacterById(targetId);
  if (!character) return null;
  const sheet = await getCharacterSheetData(targetId);
  const hpCur = Number((sheet as Record<string, unknown> | null)?.hitPointCurrent ?? 0);
  const hpMax = Number((sheet as Record<string, unknown> | null)?.hitPointMax ?? 0);
  const hpTemp = Number((sheet as Record<string, unknown> | null)?.hitPointTemp ?? 0);
  const ac = Number((sheet as Record<string, unknown> | null)?.armorClass ?? 10);
  const embed = new EmbedBuilder()
    .setColor(0xc97b4a)
    .setTitle(`${character.name} — Status`)
    .addFields(
      { name: "HP", value: hpMax > 0 ? `${hpCur} / ${hpMax}${hpTemp > 0 ? ` (+${hpTemp} temp)` : ""}` : "—", inline: true },
      { name: "AC", value: String(ac), inline: true }
    );
  if (character.portraitPath) embed.setThumbnail(character.portraitPath);
  return embed;
}
