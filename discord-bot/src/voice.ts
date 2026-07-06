import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import prism from "prism-media";
import ffmpegPath from "ffmpeg-static";

// ---------------------------------------------------------------------------
// Music playback (2026-07-06). The hardest single piece of the whole bot
// feature - see project_erendyl_discord_bot memory. Tracks live in Vercel
// Blob (same storage as portraits/maps - see music_tracks.file_url), so we
// stream them straight off their public URL through ffmpeg rather than
// downloading to disk first. ffmpeg-static bundles a real ffmpeg binary so
// the host machine doesn't need one preinstalled.
// ---------------------------------------------------------------------------

function transcode(url: string) {
  return new prism.FFmpeg({
    // -re paces output at real playback speed instead of dumping the whole
    // file into the pipe as fast as possible; the rest converts whatever
    // format the track is in into raw PCM Discord's voice encoder expects.
    args: [
      "-re",
      "-i", url,
      "-analyzeduration", "0",
      "-loglevel", "0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
    ],
  });
}

if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

export function playTrackInChannel(channel: VoiceBasedChannel, url: string): void {
  let connection = getVoiceConnection(channel.guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      // @discordjs/voice and discord.js currently ship slightly divergent
      // discord-api-types versions, which makes this assignment fail a
      // structural type check even though it's the documented usage - a
      // known ecosystem mismatch, not a real type error.
      adapterCreator: channel.guild.voiceAdapterCreator as unknown as Parameters<typeof joinVoiceChannel>[0]["adapterCreator"],
      selfDeaf: true,
    });
  }

  const player = createAudioPlayer();
  // prism.FFmpeg is itself the readable stream to consume - it has no
  // separate .output property (that was a mistaken assumption).
  const ffmpegStream = transcode(url);
  const resource = createAudioResource(ffmpegStream, { inputType: StreamType.Raw });

  connection.subscribe(player);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    ffmpegStream.destroy();
  });
  player.on("error", (err) => {
    console.error("[voice] playback error:", err.message);
    ffmpegStream.destroy();
  });
}

export function stopPlayback(guildId: string): boolean {
  const connection = getVoiceConnection(guildId);
  if (!connection) return false;
  connection.destroy();
  return true;
}

export type { VoiceConnection };
