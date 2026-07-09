import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  entersState,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import prism from "prism-media";
import ffmpegPath from "ffmpeg-static";

// (2026-07-08) @discordjs/voice never fully recovers from every disconnect on
// its own - see the reconnect handler below. To retry a track after one of
// those disconnects without also retrying forever if something is genuinely
// wrong (or racing a legitimate /stopmusic), we track which url is the
// "current" one per guild. A retry only fires if the disconnected connection
// was still playing the track this guild is supposed to be on; stopPlayback()
// clears the entry so a manual stop never triggers a retry.
const activeTrackByGuild = new Map<string, string>();
const MAX_RECONNECT_ATTEMPTS = 3;

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
    // (2026-07-08) Removed -re. It paces ffmpeg's OWN read/write to match
    // real playback speed, which is meant for live-broadcast scenarios -
    // it's redundant here since @discordjs/voice's AudioPlayer already
    // paces delivery to Discord on its own 20ms-frame timer regardless of
    // how fast upstream data arrives. Confirmed via a Vercel Blob dashboard
    // check that a track reported as cutting off after ~2s (with zero
    // ffmpeg errors, so not a decode/format issue) was in fact a complete,
    // valid, correctly-tagged 2:58 MP3 - the file itself was fine. The
    // prime remaining suspect is that -re's deliberately slow, paced reads
    // of the remote Blob URL (small bursts spread over real time, rather
    // than one fast continuous fetch) were hitting some connection-idle
    // timeout on Railway's network path to the Blob CDN, cutting the fetch
    // short well before the track's real duration. Without -re, ffmpeg
    // reads+decodes the whole file as fast as the network allows; Node's
    // own stream backpressure plus the AudioPlayer's pacing downstream
    // keep this safe (excess decoded audio just waits in the stream
    // buffer, it isn't sent to Discord early).
    // loglevel "error" (rather than fully silencing ffmpeg) so a bad/blocked
    // URL surfaces as visible stderr output instead of just silent playback
    // (2026-07-07 - "Now playing" showed but nothing was audible, and the
    // fully-silenced ffmpeg gave no clue why - though it turned out
    // prism-media never actually piped stderr anywhere; see the stderr
    // listener added in playTrackInChannel below, 2026-07-08).
    args: [
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

export function playTrackInChannel(channel: VoiceBasedChannel, url: string, retryCount = 0): void {
  const guildId = channel.guild.id;
  activeTrackByGuild.set(guildId, url);

  let connection = getVoiceConnection(guildId);
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

    // Reconnect handling (2026-07-08). Confirmed via debug logs: even after
    // DAVE fully negotiates and the connection reaches Ready, Discord's voice
    // server can tear down BOTH the websocket and UDP socket simultaneously
    // after only a few packets - observed right as a second DAVE MLS
    // epoch/transition fires for a human already in the channel (their own
    // client briefly re-joining the E2EE group, e.g. a voice-server region
    // reroute triggered by the bot joining). This is a known-unstable area of
    // @discordjs/voice 0.19.x's DAVE handling (discordjs/discord.js#11419;
    // no stable fix released as of 2026-07-08, only unreleased 0.19.3/1.0.0
    // dev builds actively working on it) - @discordjs/voice does NOT recover
    // from every disconnect type on its own, so without this handler the
    // connection just sits dead in "disconnected" forever (confirmed: no
    // further stateChange logged after it happens).
    //
    // Standard discord.js-recommended pattern: give the library a few
    // seconds to resume on its own (Signalling/Connecting); if that doesn't
    // happen, the connection is truly dead - destroy it and, if this guild is
    // still supposed to be playing this exact track (i.e. no one has since
    // called /stopmusic or picked a different track), rejoin + replay it
    // from the start. Capped at MAX_RECONNECT_ATTEMPTS so a persistently
    // broken connection fails loudly instead of retrying forever.
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection!, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection!, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Recovering on its own - nothing more to do.
      } catch {
        connection!.destroy();
        const stillActive = activeTrackByGuild.get(guildId) === url;
        if (stillActive && retryCount < MAX_RECONNECT_ATTEMPTS) {
          console.log(
            `[voice] connection dropped mid-track, reconnecting (attempt ${retryCount + 1}/${MAX_RECONNECT_ATTEMPTS})`,
          );
          setTimeout(() => playTrackInChannel(channel, url, retryCount + 1), 1_500);
        } else if (stillActive) {
          console.error(
            `[voice] gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts - connection keeps dropping (likely the @discordjs/voice DAVE bug above, not a code issue on our end)`,
          );
        }
      }
    });
  }

  const player = createAudioPlayer();
  // prism.FFmpeg is itself the readable stream to consume - it has no
  // separate .output property (that was a mistaken assumption).
  const ffmpegStream = transcode(url);

  // (2026-07-08) prism-media's FFmpeg wrapper only ever reads process.stdout
  // (the actual audio) - it never touches process.stderr, so the earlier
  // "-loglevel error" change never actually surfaced anything: ffmpeg's own
  // diagnostic output was going into an unread pipe the whole time. This is
  // the real reason "Now playing" -> near-instant "Idle" gave us zero clues.
  // Reading stderr ourselves is the only way to see whether ffmpeg is
  // hitting a genuine error (bad/blocked/truncated fetch of the Blob URL,
  // unsupported format, etc.) versus a track that's just legitimately short.
  ffmpegStream.process.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error("[voice] ffmpeg:", text);
  });

  const resource = createAudioResource(ffmpegStream, { inputType: StreamType.Raw });

  connection.subscribe(player);
  player.play(resource);

  const playbackStartedAt = Date.now();
  player.on(AudioPlayerStatus.Playing, () => console.log("[voice] player state: Playing"));
  player.on(AudioPlayerStatus.Buffering, () => console.log("[voice] player state: Buffering"));
  player.on(AudioPlayerStatus.Idle, () => {
    const elapsedMs = Date.now() - playbackStartedAt;
    console.log(`[voice] player state: Idle after ${elapsedMs}ms (track ended or was cut off)`);
    ffmpegStream.destroy();
  });
  player.on("error", (err) => {
    console.error("[voice] playback error:", err.message);
    ffmpegStream.destroy();
  });
  ffmpegStream.on("error", (err) => console.error("[voice] ffmpeg stream error:", err.message));
}

export function stopPlayback(guildId: string): boolean {
  // Clear this first so the Disconnected handler above (which fires as a
  // side effect of connection.destroy() below) sees this guild as no longer
  // "supposed to be playing" this track and skips its auto-reconnect retry.
  activeTrackByGuild.delete(guildId);
  const connection = getVoiceConnection(guildId);
  if (!connection) return false;
  connection.destroy();
  return true;
}

export type { VoiceConnection };
