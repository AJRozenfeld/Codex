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

async function handleLink(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("code", true);
  const result = await consumeLinkCode(code);
  if (!result) {
    await interaction.reply({ content: "That code is invalid or has expired - generate a new one on the website.", ephemeral: true });
    return;
  }
  if (result.kind === "campaign") {
    const member = interaction.member;
    const hasPerm =
      member && "permissions" in member && typeof member.permissions !== "string"
        ? member.permissions.has(PermissionsBitField.Flags.ManageGuild)
        : false;
    if (!hasPerm || !interaction.guildId) {
      await interaction.reply({ content: "Only a server admin (Manage Server permission) can link a campaign here.", ephemeral: true });
      return;
    }
    await linkGuildToCampaign(interaction.guildId, result.campaignId);
    await interaction.reply({ content: "This server is now linked to your campaign.", ephemeral: true });
    return;
  }
  await linkPlayerDiscordAccount(result.playerId, interaction.user.id);
  await interaction.reply({ content: "Your Discord account is now linked to your character.", ephemeral: true });
}

async function requireCampaign(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction): Promise<string | null> {
  if (!interaction.guildId) return null;
  const campaignId = await getCampaignIdForGuild(interaction.guildId);
  if (!campaignId) {
    await interaction.reply({ content: "This server isn't linked to a campaign yet - see /link.", ephemeral: true });
    return null;
  }
  return campaignId;
}

async function handlePanelNpcs(interaction: ChatInputCommandInteraction) {
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const groups = await listNpcsByFaction(campaignId);
  const factionNames = [...groups.keys()].slice(0, 25);
  if (factionNames.length === 0) {
    await interaction.reply({ content: "No NPCs yet.", ephemeral: true });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:npcs:faction")
    .setPlaceholder("Choose a faction")
    .addOptions(factionNames.map((f) => ({ label: f.slice(0, 100), value: f.slice(0, 100) })));
  await interaction.reply({
    content: "Browse NPCs:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  });
}

async function handlePanelLocations(interaction: ChatInputCommandInteraction) {
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const locations = await listLocations(campaignId);
  if (locations.length === 0) {
    await interaction.reply({ content: "No locations yet.", ephemeral: true });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:locations:pick")
    .setPlaceholder("Choose a location")
    .addOptions(locations.slice(0, 25).map((l) => ({ label: l.name.slice(0, 100), value: l.id, description: l.type })));
  await interaction.reply({
    content: "Browse locations:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  });
}

async function handlePanelMusic(interaction: ChatInputCommandInteraction) {
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const tracks = await listMusicTracks(campaignId);
  if (tracks.length === 0) {
    await interaction.reply({ content: "No tracks uploaded yet - add some from /admin/music on the website.", ephemeral: true });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:music:pick")
    .setPlaceholder("Choose a track")
    .addOptions(tracks.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: t.id, description: t.tags ?? undefined })));
  await interaction.reply({
    content: "Play a track (you must be in a voice channel):",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  });
}

async function handleStopMusic(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return;
  const stopped = stopPlayback(interaction.guildId);
  await interaction.reply({ content: stopped ? "Stopped." : "Nothing is playing.", ephemeral: true });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const [, kind, step] = interaction.customId.split(":");
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;

  if (kind === "npcs" && step === "faction") {
    const faction = interaction.values[0];
    const groups = await listNpcsByFaction(campaignId);
    const npcs = groups.get(faction) ?? [];
    if (npcs.length === 0) {
      await interaction.update({ content: `No NPCs in ${faction}.`, components: [] });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId("panel:npcs:npc")
      .setPlaceholder("Choose an NPC")
      .addOptions(npcs.slice(0, 25).map((n) => ({ label: n.name.slice(0, 100), value: n.id })));
    await interaction.update({
      content: `NPCs in **${faction}**:`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  if (kind === "npcs" && step === "npc") {
    const character = await getCharacterById(interaction.values[0]);
    if (!character) {
      await interaction.update({ content: "That NPC no longer exists.", components: [] });
      return;
    }
    await interaction.update({ content: "", embeds: [characterEmbed(character)], components: [] });
    return;
  }

  if (kind === "locations" && step === "pick") {
    const locations = await listLocations(campaignId);
    const location = locations.find((l) => l.id === interaction.values[0]);
    if (!location) {
      await interaction.update({ content: "That location no longer exists.", components: [] });
      return;
    }
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(location.name).setDescription(location.description).addFields([
      { name: "Type", value: location.type, inline: true },
    ]);
    await interaction.update({ content: "", embeds: [embed], components: [] });
    return;
  }

  if (kind === "music" && step === "pick") {
    const track = await getMusicTrackById(interaction.values[0]);
    if (!track) {
      await interaction.update({ content: "That track no longer exists.", components: [] });
      return;
    }
    const member = interaction.member;
    const voiceChannel =
      member && "voice" in member && member.voice && "channel" in member.voice ? member.voice.channel : null;
    if (!voiceChannel) {
      await interaction.update({ content: "Join a voice channel first, then try again.", components: [] });
      return;
    }
    playTrackInChannel(voiceChannel, track.fileUrl);
    await interaction.update({ content: `Now playing **${track.name}** in ${voiceChannel.name}.`, components: [] });
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
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
    }
  }
}
