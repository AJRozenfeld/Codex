import { EmbedBuilder, type TextChannel, type VoiceBasedChannel } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import {
  getActiveBattle,
  startBattle,
  setTrackerMessageId,
  getBattleCombatants,
  recordInitiativeRoll,
  advanceBattleTurn,
  endBattle,
  getRandomBattleTrack,
  getGuildPlaybackTrackId,
  setGuildPlaybackTrackId,
  getMusicTrackById,
  type BattleState,
  type BattleCombatant,
} from "./db.js";
import { playTrackInChannel, stopPlayback } from "./voice.js";

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
      const marker = c.characterId === battle.currentCharacterId ? "▶" : "•";
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
): Promise<{ roundNumber: number; currentCharacterId: string } | null> {
  const result = await advanceBattleTurn(battle.id);
  if (!result) return null;
  await refreshTracker(channel, { ...battle, roundNumber: result.roundNumber, currentCharacterId: result.currentCharacterId });
  return result;
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
