import { EmbedBuilder, type TextChannel, type VoiceBasedChannel } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import {
  getActiveBattle,
  startBattle,
  setTrackerMessageId,
  getBattleCombatants,
  recordInitiativeRoll,
  insertCreatureCombatant,
  advanceBattleTurn,
  endBattle,
  getRandomBattleTrack,
  getGuildPlaybackTrackId,
  setGuildPlaybackTrackId,
  getMusicTrackById,
  getPlaylistTracks,
  getSceneForActivation,
  getCharacterSheetData,
  type BattleState,
  type BattleCombatant,
} from "./db.js";
import { playTrackInChannel, playPlaylistInChannel, stopPlayback } from "./voice.js";
import { rollD20, computeInitiative } from "./rolls.js";

// ---------------------------------------------------------------------------
// Discord-facing orchestration for the initiative tracker / battle mode
// (Aviv's spec, 2026-07-06). db.ts holds the raw queries; this module owns
// everything that actually touches the Discord API - rendering the tracker
// embed, deciding whether to edit the existing tracker message or post a
// fresh one, and joining/resuming voice playback around a fight.
// ---------------------------------------------------------------------------

const GOLD = 0xd97706;

function renderTrackerEmbed(battle: BattleState, combatants: BattleCombatant[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(GOLD).setTitle(`⚔️ Initiative — Round ${battle.roundNumber}`);
  if (combatants.length === 0) {
    embed.setDescription("_Waiting for rolls - use `[[YourMask]]: *init*` to roll initiative._");
  } else {
    const lines = combatants.map((c) => {
      const marker = c.id === battle.currentCombatantId ? "▶" : "•";
      return `${marker} **${c.name}** — ${c.initiativeScore}`;
    });
    embed.setDescription(lines.join("\n"));
  }
  embed.setFooter({ text: "DM: /next to advance a turn, /endbattle to end the fight" });
  return embed;
}

/**
 * (Re)renders the tracker embed into `battle.channelId`, editing the
 * existing tracker message if one exists, or posting (and remembering) a
 * fresh one otherwise - e.g. if the old message was deleted out from under
 * us, or this is the very first render after /startbattle.
 */
export async function refreshTracker(channel: TextChannel, battle: BattleState): Promise<void> {
  const combatants = await getBattleCombatants(battle.id);
  const embed = renderTrackerEmbed(battle, combatants);
  if (battle.trackerMessageId) {
    try {
      const msg = await channel.messages.fetch(battle.trackerMessageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // Fall through and post a fresh tracker message below.
    }
  }
  const msg = await channel.send({ embeds: [embed] });
  await setTrackerMessageId(battle.id, msg.id);
}

/**
 * Starts a battle: snapshots whatever was playing before (so it can be
 * restored later), picks a random track tagged "battle" and plays it if the
 * DM is in a voice channel, and posts the initial (empty) tracker embed.
 */
export async function beginBattle(
  guildId: string,
  campaignId: string,
  channel: TextChannel,
  voiceChannel: VoiceBasedChannel | null
): Promise<{ battle: BattleState; musicStarted: boolean }> {
  const previousTrackId = await getGuildPlaybackTrackId(guildId);
  const battle = await startBattle(guildId, campaignId, channel.id, previousTrackId);

  let musicStarted = false;
  if (voiceChannel) {
    const track = await getRandomBattleTrack(campaignId);
    if (track) {
      playTrackInChannel(voiceChannel, track.fileUrl);
      await setGuildPlaybackTrackId(guildId, track.id);
      musicStarted = true;
    }
  }

  await refreshTracker(channel, battle);
  return { battle, musicStarted };
}

export async function recordRollAndRefresh(
  channel: TextChannel,
  battle: BattleState,
  characterId: string,
  score: number
): Promise<void> {
  await recordInitiativeRoll(battle.id, characterId, score);
  await refreshTracker(channel, battle);
}

/** Advances the turn and refreshes the tracker. Returns null if nobody has rolled yet. */
export async function nextTurn(
  channel: TextChannel,
  battle: BattleState
): Promise<{ roundNumber: number; currentCombatantId: string } | null> {
  const result = await advanceBattleTurn(battle.id);
  if (!result) return null;
  await refreshTracker(channel, { ...battle, roundNumber: result.roundNumber, currentCombatantId: result.currentCombatantId });
  return result;
}

/**
 * Activates a Scene (Aviv's spec, 2026-07-12): starts a battle exactly like
 * /startbattle, then auto-rolls initiative for every creature/character
 * listed on the scene and starts whatever music it links - all in one call,
 * since the whole point is a "hotkey" that replaces the manual
 * /startbattle -> wait for *init* rolls -> pick a track dance.
 *
 * Creatures can't type `[[mask]]: *init*` themselves, so each instance gets
 * a d20 + its stored init_bonus rolled right here via insertCreatureCombatant
 * (character_id NULL, a plain display name instead - see db/schema.sql's
 * battle_combatants comment). `quantity` expands into that many separately
 * numbered combatants ("Goblin 1"/"Goblin 2"/...) per Aviv's call, so each
 * can be tracked and "killed" independently rather than as one lumped line;
 * quantity=1 gets a bare name with no suffix.
 *
 * Existing Codex characters attached to the scene (scene_characters) are
 * NOT auto-suffixed or hand-waved the same way - they still roll their own
 * Dexterity-based initiative via computeInitiative, exactly as if the DM had
 * typed `[[mask]]: *init*` for them, since a named NPC (or, unusually, a PC)
 * already has a real character sheet to roll against.
 */
export async function activateScene(
  guildId: string,
  campaignId: string,
  channel: TextChannel,
  voiceChannel: VoiceBasedChannel | null,
  sceneId: string
): Promise<{ battle: BattleState; musicStarted: boolean; combatantCount: number } | null> {
  const scene = await getSceneForActivation(sceneId);
  if (!scene) return null;

  const previousTrackId = await getGuildPlaybackTrackId(guildId);
  const battle = await startBattle(guildId, campaignId, channel.id, previousTrackId);

  let combatantCount = 0;
  for (const creature of scene.creatures) {
    const quantity = Math.max(1, creature.quantity);
    for (let i = 1; i <= quantity; i++) {
      const instanceName = quantity > 1 ? `${creature.name} ${i}` : creature.name;
      const score = rollD20() + creature.initBonus;
      await insertCreatureCombatant(battle.id, instanceName, score);
      combatantCount++;
    }
  }
  for (const characterId of scene.characterIds) {
    const sheet = await getCharacterSheetData(characterId);
    const roll = computeInitiative(sheet);
    await recordInitiativeRoll(battle.id, characterId, roll.total);
    combatantCount++;
  }

  let musicStarted = false;
  if (voiceChannel) {
    if (scene.playlistId) {
      const tracks = await getPlaylistTracks(scene.playlistId);
      if (tracks.length > 0) {
        playPlaylistInChannel(voiceChannel, tracks, scene.shuffle);
        await setGuildPlaybackTrackId(guildId, tracks[0].id);
        musicStarted = true;
      }
    } else if (scene.trackId) {
      const track = await getMusicTrackById(scene.trackId);
      if (track) {
        playTrackInChannel(voiceChannel, track.fileUrl);
        await setGuildPlaybackTrackId(guildId, track.id);
        musicStarted = true;
      }
    }
  }

  await refreshTracker(channel, battle);
  return { battle, musicStarted, combatantCount };
}

/**
 * Ends a battle: deletes the tracker message entirely (per Aviv's spec, it
 * "disappears" rather than being left behind in a finished state), restores
 * whichever track was playing before the fight (from the top, not a
 * mid-song position - see the design note in schema.sql), or just stops
 * playback if nothing was playing before, then clears the battle's DB state.
 */
export async function finishBattle(guildId: string, channel: TextChannel, battle: BattleState): Promise<void> {
  if (battle.trackerMessageId) {
    try {
      const msg = await channel.messages.fetch(battle.trackerMessageId);
      await msg.delete();
    } catch {
      // Already gone - nothing to clean up.
    }
  }

  if (battle.previousTrackId) {
    const track = await getMusicTrackById(battle.previousTrackId);
    const connection = getVoiceConnection(guildId);
    const voiceChannelId = connection?.joinConfig.channelId;
    const voiceChannel = voiceChannelId ? await channel.guild.channels.fetch(voiceChannelId).catch(() => null) : null;
    if (track && voiceChannel && voiceChannel.isVoiceBased()) {
      playTrackInChannel(voiceChannel, track.fileUrl);
    }
    await setGuildPlaybackTrackId(guildId, battle.previousTrackId);
  } else {
    stopPlayback(guildId);
    await setGuildPlaybackTrackId(guildId, null);
  }

  await endBattle(battle.id);
}

export { getActiveBattle };
