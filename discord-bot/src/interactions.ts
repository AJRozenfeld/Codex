import {
  type Interaction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import {
  consumeLinkCode,
  linkGuildToCampaign,
  linkPlayerDiscordAccount,
  getCampaignIdForGuild,
  listNpcsByFaction,
  getCharacterById,
  listLocations,
  listMusicTracks,
  getMusicTrackById,
  type BotCharacter,
} from "./db.js";
import { playTrackInChannel, stopPlayback } from "./voice.js";

const GOLD = 0xd97706;

function characterEmbed(character: BotCharacter): EmbedBuilder {
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

// ---------------------------------------------------------------------------
// Every handler below defers immediately, before doing any database work.
// Discord requires an initial ack within 3 seconds of an interaction firing;
// every handler here does at least one DB round-trip first, and on some
// networks that alone can occasionally exceed 3 seconds (confirmed
// 2026-07-06 - Aviv's /link genuinely succeeded in the database while
// Discord still showed "The application did not respond", DiscordAPIError
// 10062 "Unknown interaction" once the late reply finally landed - and the
// same code then failed on retry because it had already been marked used
// by the first, silently-successful attempt). Deferring first buys a full
// 15 minutes to finish via editReply(), regardless of how slow any given
// DB call happens to be.
// ---------------------------------------------------------------------------

async function handleLink(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const code = interaction.options.getString("code", true);
  const result = await consumeLinkCode(code);
  if (!result) {
    await interaction.editReply({ content: "That code is invalid or has expired - generate a new one on the website." });
    return;
  }
  if (result.kind === "campaign") {
    const member = interaction.member;
    const hasPerm =
      member && "permissions" in member && typeof member.permissions !== "string"
        ? member.permissions.has(PermissionsBitField.Flags.ManageGuild)
        : false;
    if (!hasPerm || !interaction.guildId) {
      await interaction.editReply({ content: "Only a server admin (Manage Server permission) can link a campaign here." });
      return;
    }
    await linkGuildToCampaign(interaction.guildId, result.campaignId);
    await interaction.editReply({ content: "This server is now linked to your campaign." });
    return;
  }
  await linkPlayerDiscordAccount(result.playerId, interaction.user.id);
  await interaction.editReply({ content: "Your Discord account is now linked to your character." });
}

/**
 * Resolves the linked campaign for an ALREADY-DEFERRED interaction (every
 * caller below defers before calling this). Returns null and finalizes the
 * deferred reply itself with an explanatory message if this server isn't
 * linked yet - callers just bail out when they get null back.
 */
async function requireCampaign(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction): Promise<string | null> {
  if (!interaction.guildId) return null;
  const campaignId = await getCampaignIdForGuild(interaction.guildId);
  if (!campaignId) {
    await interaction.editReply({ content: "This server isn't linked to a campaign yet - see /link." });
    return null;
  }
  return campaignId;
}

async function handlePanelNpcs(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const groups = await listNpcsByFaction(campaignId);
  const factionNames = [...groups.keys()].slice(0, 25);
  if (factionNames.length === 0) {
    await interaction.editReply({ content: "No NPCs yet." });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:npcs:faction")
    .setPlaceholder("Choose a faction")
    .addOptions(factionNames.map((f) => ({ label: f.slice(0, 100), value: f.slice(0, 100) })));
  await interaction.editReply({
    content: "Browse NPCs:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function handlePanelLocations(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const locations = await listLocations(campaignId);
  if (locations.length === 0) {
    await interaction.editReply({ content: "No locations yet." });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:locations:pick")
    .setPlaceholder("Choose a location")
    .addOptions(locations.slice(0, 25).map((l) => ({ label: l.name.slice(0, 100), value: l.id, description: l.type })));
  await interaction.editReply({
    content: "Browse locations:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function handlePanelMusic(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const tracks = await listMusicTracks(campaignId);
  if (tracks.length === 0) {
    await interaction.editReply({ content: "No tracks uploaded yet - add some from /admin/music on the website." });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:music:pick")
    .setPlaceholder("Choose a track")
    .addOptions(tracks.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: t.id, description: t.tags ?? undefined })));
  await interaction.editReply({
    content: "Play a track (you must be in a voice channel):",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function handleStopMusic(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guildId) {
    await interaction.editReply({ content: "This only works in a server." });
    return;
  }
  const stopped = stopPlayback(interaction.guildId);
  await interaction.editReply({ content: stopped ? "Stopped." : "Nothing is playing." });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  // Component (select-menu) interactions use deferUpdate()/editReply()
  // rather than deferReply()/editReply() - same 3-second-ack rule, same fix.
  await interaction.deferUpdate();
  const [, kind, step] = interaction.customId.split(":");
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;

  if (kind === "npcs" && step === "faction") {
    const faction = interaction.values[0];
    const groups = await listNpcsByFaction(campaignId);
    const npcs = groups.get(faction) ?? [];
    if (npcs.length === 0) {
      await interaction.editReply({ content: `No NPCs in ${faction}.`, components: [] });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId("panel:npcs:npc")
      .setPlaceholder("Choose an NPC")
      .addOptions(npcs.slice(0, 25).map((n) => ({ label: n.name.slice(0, 100), value: n.id })));
    await interaction.editReply({
      content: `NPCs in **${faction}**:`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  if (kind === "npcs" && step === "npc") {
    const character = await getCharacterById(interaction.values[0]);
    if (!character) {
      await interaction.editReply({ content: "That NPC no longer exists.", components: [] });
      return;
    }
    await interaction.editReply({ content: "", embeds: [characterEmbed(character)], components: [] });
    return;
  }

  if (kind === "locations" && step === "pick") {
    const locations = await listLocations(campaignId);
    const location = locations.find((l) => l.id === interaction.values[0]);
    if (!location) {
      await interaction.editReply({ content: "That location no longer exists.", components: [] });
      return;
    }
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(location.name).setDescription(location.description).addFields([
      { name: "Type", value: location.type, inline: true },
    ]);
    await interaction.editReply({ content: "", embeds: [embed], components: [] });
    return;
  }

  if (kind === "music" && step === "pick") {
    const track = await getMusicTrackById(interaction.values[0]);
    if (!track) {
      await interaction.editReply({ content: "That track no longer exists.", components: [] });
      return;
    }
    const member = interaction.member;
    const voiceChannel =
      member && "voice" in member && member.voice && "channel" in member.voice ? member.voice.channel : null;
    if (!voiceChannel) {
      await interaction.editReply({ content: "Join a voice channel first, then try again.", components: [] });
      return;
    }
    playTrackInChannel(voiceChannel, track.fileUrl);
    await interaction.editReply({ content: `Now playing **${track.name}** in ${voiceChannel.name}.`, components: [] });
    return;
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "link") return void (await handleLink(interaction));
      if (interaction.commandName === "stopmusic") return void (await handleStopMusic(interaction));
      if (interaction.commandName === "panel") {
        const sub = interaction.options.getSubcommand();
        if (sub === "npcs") return void (await handlePanelNpcs(interaction));
        if (sub === "locations") return void (await handlePanelLocations(interaction));
        if (sub === "music") return void (await handlePanelMusic(interaction));
      }
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    }
  } catch (err) {
    console.error("[interaction] error:", err);
    // If we'd already deferred/replied by the time this threw, finish the
    // response via editReply instead of trying (and failing) to reply again.
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "Something went wrong." }).catch(() => {});
      } else {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
      }
    }
  }
}
