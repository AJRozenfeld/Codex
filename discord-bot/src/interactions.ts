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
  setGuildPlaybackTrackId,
  listPlaylists,
  getPlaylistTracks,
  listScenes,
  type BotCharacter,
} from "./db.js";
import { playTrackInChannel, playPlaylistInChannel, stopPlayback } from "./voice.js";
import { getActiveBattle, beginBattle, nextTurn, finishBattle, activateScene } from "./battle.js";

const GOLD = 0xd97706;

/**
 * DM-gate shared by every battle command and the campaign-linking branch of
 * /link - same "Manage Server" permission concept used throughout the bot,
 * not a new one. Extracted here (2026-07-06) so the battle commands below
 * don't duplicate the inline check that used to live only in handleLink.
 */
function isDm(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  return !!(
    member &&
    "permissions" in member &&
    typeof member.permissions !== "string" &&
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

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
    if (!isDm(interaction) || !interaction.guildId) {
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

/**
 * Entry point for /panel music (2026-07-10). First asks Track vs Playlist -
 * see panel:music:mode in handleSelectMenu below for the rest of the flow
 * (playlist -> pick which one -> normal/shuffle -> playback starts).
 */
async function handlePanelMusic(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  const [tracks, playlists] = await Promise.all([listMusicTracks(campaignId), listPlaylists(campaignId)]);
  if (tracks.length === 0) {
    await interaction.editReply({ content: "No tracks uploaded yet - add some from /admin/music on the website." });
    return;
  }
  const options = [{ label: "A single track", value: "track", description: `${tracks.length} available` }];
  if (playlists.length > 0) {
    options.push({ label: "A playlist", value: "playlist", description: `${playlists.length} available` });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:music:mode")
    .setPlaceholder("Track or playlist?")
    .addOptions(options);
  await interaction.editReply({
    content: "Play music (you must be in a voice channel):",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/**
 * Entry point for /panel scenes (Aviv's spec, 2026-07-12) - a "hotkey" for
 * battle setup. DM-gated and blocked while a battle is already in progress,
 * same as /startbattle - the actual work (auto-rolling every creature/
 * character, starting music) happens in activateScene once a scene is
 * picked from the menu below (see the "scenes":"pick" branch in
 * handleSelectMenu).
 */
async function handlePanelScenes(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isDm(interaction) || !interaction.guildId) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can activate a scene." });
    return;
  }
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.editReply({ content: "This only works in a server text channel." });
    return;
  }
  const existing = await getActiveBattle(interaction.guildId);
  if (existing) {
    await interaction.editReply({ content: "A battle is already in progress here - use /endbattle first." });
    return;
  }
  const scenes = await listScenes(campaignId);
  if (scenes.length === 0) {
    await interaction.editReply({ content: "No scenes yet - create one from /admin/scenes on the website." });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:scenes:pick")
    .setPlaceholder("Choose a scene to activate")
    .addOptions(scenes.slice(0, 25).map((s) => ({ label: s.name.slice(0, 100), value: s.id })));
  await interaction.editReply({
    content: "Activate a scene (starts a battle and music):",
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
  if (stopped) await setGuildPlaybackTrackId(interaction.guildId, null);
  await interaction.editReply({ content: stopped ? "Stopped." : "Nothing is playing." });
}

/**
 * Starts a battle: rolls-for-initiative prompt goes out via the tracker
 * embed itself ("Waiting for rolls..."), battle music (a random track
 * tagged "battle") starts if the DM is in a voice channel, and the previous
 * track is snapshotted so /endbattle can restore it. Aviv's spec, 2026-07-06.
 */
async function handleStartBattle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isDm(interaction) || !interaction.guildId) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can start a battle." });
    return;
  }
  const campaignId = await requireCampaign(interaction);
  if (!campaignId) return;
  if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.editReply({ content: "This only works in a server text channel." });
    return;
  }
  const existing = await getActiveBattle(interaction.guildId);
  if (existing) {
    await interaction.editReply({ content: "A battle is already in progress here - use /endbattle first." });
    return;
  }
  const member = interaction.member;
  const voiceChannel =
    member && "voice" in member && member.voice && "channel" in member.voice ? member.voice.channel : null;
  const { musicStarted } = await beginBattle(
    interaction.guildId,
    campaignId,
    interaction.channel as import("discord.js").TextChannel,
    voiceChannel
  );
  await interaction.editReply({
    content: musicStarted
      ? "Battle started! Roll for initiative with `[[YourMask]]: *init*`."
      : "Battle started! Roll for initiative with `[[YourMask]]: *init*`. (No battle music played - join a voice channel and tag a track \"battle\" to enable it.)",
  });
}

/** DM-only: advances to the next turn in the sorted initiative order. */
async function handleNext(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isDm(interaction) || !interaction.guildId) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can advance the turn." });
    return;
  }
  if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.editReply({ content: "This only works in a server text channel." });
    return;
  }
  const battle = await getActiveBattle(interaction.guildId);
  if (!battle) {
    await interaction.editReply({ content: "No battle is in progress - use /startbattle first." });
    return;
  }
  const result = await nextTurn(interaction.channel as import("discord.js").TextChannel, battle);
  if (!result) {
    await interaction.editReply({ content: "Nobody has rolled for initiative yet." });
    return;
  }
  await interaction.editReply({ content: `Round ${result.roundNumber} - advanced.` });
}

/** DM-only: ends the battle, restores the previous track, and removes the tracker. */
async function handleEndBattle(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isDm(interaction) || !interaction.guildId) {
    await interaction.editReply({ content: "Only a DM (Manage Server permission) can end a battle." });
    return;
  }
  if (!interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
    await interaction.editReply({ content: "This only works in a server text channel." });
    return;
  }
  const battle = await getActiveBattle(interaction.guildId);
  if (!battle) {
    await interaction.editReply({ content: "No battle is in progress." });
    return;
  }
  await finishBattle(interaction.guildId, interaction.channel as import("discord.js").TextChannel, battle);
  await interaction.editReply({ content: "Battle ended." });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  // Component (select-menu) interactions use deferUpdate()/editReply()
  // rather than deferReply()/editReply() - same 3-second-ack rule, same fix.
  await interaction.deferUpdate();
  // ...rest carries extra state through multi-step flows (currently just the
  // playlist id for panel:music:playmode:<playlistId>) - see handlePanelMusic
  // above for why a plain customId can't hold it any other way (Discord
  // select-menu values only round-trip the OPTION the user picked, not any
  // context from earlier steps).
  const [, kind, step, ...rest] = interaction.customId.split(":");
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

  // (2026-07-10) Step 1 of the playlist flow: Track vs Playlist, chosen from
  // handlePanelMusic's initial menu. "track" reuses the exact single-track
  // menu/handler that already existed (panel:music:pick, below); "playlist"
  // branches into the two new steps that follow.
  if (kind === "music" && step === "mode") {
    if (interaction.values[0] === "track") {
      const tracks = await listMusicTracks(campaignId);
      const menu = new StringSelectMenuBuilder()
        .setCustomId("panel:music:pick")
        .setPlaceholder("Choose a track")
        .addOptions(tracks.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: t.id, description: t.tags ?? undefined })));
      await interaction.editReply({
        content: "Play a track (you must be in a voice channel):",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      });
      return;
    }
    const playlists = await listPlaylists(campaignId);
    if (playlists.length === 0) {
      await interaction.editReply({ content: "No playlists yet - create one from /admin/playlists on the website.", components: [] });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId("panel:music:playlist")
      .setPlaceholder("Choose a playlist")
      .addOptions(playlists.slice(0, 25).map((p) => ({ label: p.name.slice(0, 100), value: p.id, description: `${p.trackCount} track${p.trackCount === 1 ? "" : "s"}` })));
    await interaction.editReply({
      content: "Choose a playlist:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  // Step 2 of the playlist flow: which playlist, then ask normal vs shuffle.
  // The chosen playlist id has to ride along in the NEXT menu's customId
  // (panel:music:playmode:<playlistId>) since a select-menu interaction only
  // ever reports back the option the user just picked, not anything from an
  // earlier step - see the `rest` destructuring above.
  if (kind === "music" && step === "playlist") {
    const playlistId = interaction.values[0];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`panel:music:playmode:${playlistId}`)
      .setPlaceholder("Play in order or shuffled?")
      .addOptions([
        { label: "In order", value: "normal", description: "Play from the top, as listed on the website" },
        { label: "Shuffle", value: "shuffle", description: "Play in a random order" },
      ]);
    await interaction.editReply({
      content: "Normal or shuffle?",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  // Step 3 of the playlist flow: normal/shuffle chosen - start playback.
  if (kind === "music" && step === "playmode") {
    const playlistId = rest[0];
    const shuffle = interaction.values[0] === "shuffle";
    const tracks = await getPlaylistTracks(playlistId);
    if (tracks.length === 0) {
      await interaction.editReply({ content: "That playlist has no tracks (or no longer exists).", components: [] });
      return;
    }
    const member = interaction.member;
    const voiceChannel =
      member && "voice" in member && member.voice && "channel" in member.voice ? member.voice.channel : null;
    if (!voiceChannel) {
      await interaction.editReply({ content: "Join a voice channel first, then try again.", components: [] });
      return;
    }
    playPlaylistInChannel(voiceChannel, tracks, shuffle);
    if (interaction.guildId) await setGuildPlaybackTrackId(interaction.guildId, tracks[0].id);
    await interaction.editReply({
      content: `Now playing **${tracks.length}-track playlist** (${shuffle ? "shuffled" : "in order"}) in ${voiceChannel.name}.`,
      components: [],
    });
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
    if (interaction.guildId) await setGuildPlaybackTrackId(interaction.guildId, track.id);
    await interaction.editReply({ content: `Now playing **${track.name}** in ${voiceChannel.name}.`, components: [] });
    return;
  }

  // Scene activation (2026-07-12) - the actual "hotkey" moment. Re-checks for
  // a since-started battle (a race is unlikely but cheap to guard against,
  // same spirit as the other battle commands' upfront checks) before handing
  // off to activateScene, which does all the real work.
  if (kind === "scenes" && step === "pick") {
    if (!interaction.guildId || !interaction.channel || !interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
      await interaction.editReply({ content: "This only works in a server text channel.", components: [] });
      return;
    }
    const existing = await getActiveBattle(interaction.guildId);
    if (existing) {
      await interaction.editReply({ content: "A battle is already in progress here - use /endbattle first.", components: [] });
      return;
    }
    const member = interaction.member;
    const voiceChannel =
      member && "voice" in member && member.voice && "channel" in member.voice ? member.voice.channel : null;
    const result = await activateScene(
      interaction.guildId,
      campaignId,
      interaction.channel as import("discord.js").TextChannel,
      voiceChannel,
      interaction.values[0]
    );
    if (!result) {
      await interaction.editReply({ content: "That scene no longer exists.", components: [] });
      return;
    }
    const musicNote = result.musicStarted
      ? ""
      : " (No music started - join a voice channel first, or link a track/playlist to this scene on the website.)";
    await interaction.editReply({
      content: `Scene activated! Rolled initiative for ${result.combatantCount} combatant${result.combatantCount === 1 ? "" : "s"}.${musicNote} Existing characters still roll their own with \`[[YourMask]]: *init*\`.`,
      components: [],
    });
    return;
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "link") return void (await handleLink(interaction));
      if (interaction.commandName === "stopmusic") return void (await handleStopMusic(interaction));
      if (interaction.commandName === "startbattle") return void (await handleStartBattle(interaction));
      if (interaction.commandName === "next") return void (await handleNext(interaction));
      if (interaction.commandName === "endbattle") return void (await handleEndBattle(interaction));
      if (interaction.commandName === "panel") {
        const sub = interaction.options.getSubcommand();
        if (sub === "npcs") return void (await handlePanelNpcs(interaction));
        if (sub === "locations") return void (await handlePanelLocations(interaction));
        if (sub === "music") return void (await handlePanelMusic(interaction));
        if (sub === "scenes") return void (await handlePanelScenes(interaction));
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
