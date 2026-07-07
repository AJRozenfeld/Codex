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
    // loglevel "error" (rather than fully silencing ffmpeg) so a bad/blocked
    // URL surfaces as visible stderr output instead of just silent playback
    // (2026-07-07 - "Now playing" showed but nothing was audible, and the
    // fully-silenced ffmpeg gave no clue why).
    args: [
      "-re",
      "-i", url,
      "-analyzeduration", "0",
      "-loglevel", "error",
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
      // Root cause of the connection stuck cycling signalling <-> connecting
      // forever, identically on Aviv's home network AND on Railway (2026-07-07)
      // - Discord made DAVE end-to-end voice encryption mandatory on every
      // voice channel starting March 2026, and our previous @discordjs/voice
      // (0.17.0) predated DAVE support entirely. Bumped to 0.19.2, which
      // defaults daveEncryption to true - confirmed via debug logging that
      // setting it to *false* was the wrong direction: our IDENTIFY was
      // advertising "max_dave_protocol_version":0 (no DAVE support), and
      // Discord's voice server was silently closing the WebSocket right
      // after HELLO in response, since opting out isn't actually allowed
      // anymore. Leaving this at the default (true) so the handshake
      // actually completes. The known open bugs in 0.19.x's DAVE handling
      // (discordjs/discord.js#11419) are specifically about *receiving* and
      // decrypting incoming audio via VoiceReceiver - this bot only ever
      // sends generated audio and never uses VoiceReceiver, so they
      // shouldn't apply here.
      // (2026-07-07) The high-level state log alone (signalling/connecting)
      // wasn't enough to diagnose this past two attempts - it shows WHEN
      // the connection stalls but not WHY. debug:true makes @discordjs/voice
      // emit its full internal handshake log (WS frames, UDP discovery,
      // exact failure/close reasons) via the 'debug' event below.
      debug: true,
    });

    // Diagnostics (2026-07-07): joining + playing can both "succeed" from
    // this function's point of view (no thrown error, "Now playing" posted)
    // while nothing is actually audible. First round of logging (Ready/
    // Disconnected/Destroyed only) never printed anything at all, which
    // means the connection is getting stuck in an EARLIER transitional
    // state (Signalling or Connecting) and never reaching Ready - the
    // AudioPlayer's "Playing" status is independent of the connection
    // actually being able to transmit audio, so it reports "Playing" even
    // into a connection that's still stuck handshaking. Logging every
    // stateChange (not just the 3 named ones) shows exactly where it stalls.
    console.log("[voice] connection created, initial state:", connection.state.status);
    connection.on("error", (err) => console.error("[voice] connection error:", err.message));
    connection.on("stateChange", (oldState, newState) => {
      console.log(`[voice] connection state: ${oldState.status} -> ${newState.status}`);
    });
    connection.on("debug", (message) => console.log("[voice debug]", message));
  }

  const player = createAudioPlayer();
  // prism.FFmpeg is itself the readable stream to consume - it has no
  // separate .output property (that was a mistaken assumption).
  const ffmpegStream = transcode(url);
  const resource = createAudioResource(ffmpegStream, { inputType: StreamType.Raw });

  connection.subscribe(player);
  player.play(resource);

  player.on(AudioPlayerStatus.Playing, () => console.log("[voice] player state: Playing"));
  player.on(AudioPlayerStatus.Buffering, () => console.log("[voice] player state: Buffering"));
  player.on(AudioPlayerStatus.Idle, () => {
    console.log("[voice] player state: Idle (track ended or was cut off)");
    ffmpegStream.destroy();
  });
  player.on("error", (err) => {
    console.error("[voice] playback error:", err.message);
    ffmpegStream.destroy();
  });
  ffmpegStream.on("error", (err) => console.error("[voice] ffmpeg stream error:", err.message));
}

export function stopPlayback(guildId: string): boolean {
  const connection = getVoiceConnection(guildId);
  if (!connection) return false;
  connection.destroy();
  return true;
}

export type { VoiceConnection };
