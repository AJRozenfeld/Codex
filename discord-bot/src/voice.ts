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
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// (2026-07-08) Confirmed via a real playback attempt: ffmpeg's process
// exits with signal=SIGSEGV and pcmBytesReceived=0 - it crashes before
// decoding a single byte, on every track, regardless of the -re flag or
// the source file (already verified via the Vercel Blob dashboard to be a
// complete, valid, correctly-tagged MP3). A segfault this consistent and
// this early points at the ffmpeg-static binary itself, not our command-
// line args or the network fetch - most likely a CPU-architecture
// mismatch or a corrupted/incomplete download during Railway's own
// npm install (ffmpeg-static downloads a real prebuilt binary from GitHub
// releases in a postinstall step; if that step ran against a different
// arch than the container actually runs on, or got truncated, the
// resulting binary can crash immediately on exec).
//
// This one-time startup check runs `ffmpeg -version` synchronously as
// soon as the bot boots (not per-track) so the very next restart's logs
// show, immediately and unambiguously: whether ffmpegPath even resolved,
// the binary's file size on disk (a real static ffmpeg build is roughly
// 70-80MB - anything drastically smaller points at a truncated/corrupted
// download), and whether invoking it AT ALL (with no input file, no
// network involved) also segfaults - which would conclusively prove the
// binary itself is broken, rather than anything specific to transcoding.
if (ffmpegPath) {
  try {
    const size = statSync(ffmpegPath).size;
    console.log(`[voice] ffmpeg binary at ${ffmpegPath}, size=${size} bytes`);
  } catch (err) {
    console.error(`[voice] ffmpeg binary missing at ${ffmpegPath}:`, (err as Error).message);
  }
  try {
    const version = execFileSync(ffmpegPath, ["-version"], { timeout: 5_000 }).toString().split("\n")[0];
    console.log(`[voice] ffmpeg -version OK: ${version}`);
  } catch (err) {
    console.error(`[voice] ffmpeg -version FAILED (binary itself is broken):`, (err as Error).message);
  }
} else {
  console.error("[voice] ffmpeg-static resolved no binary path for this platform/arch");
}

// (2026-07-09) The startup diagnostic above proved the ffmpeg-static binary
// itself is fine - correct size (79.8MB), `ffmpeg -version` runs cleanly with
// no input and no network involved. So the SIGSEGV only happens when ffmpeg
// is actually asked to fetch+demux a remote https:// URL itself. Static
// ffmpeg builds (this one is johnvansickle's) are known to be less robust
// at their own network/TLS input handling than a real HTTP client - as
// opposed to a crash in decoding the audio content itself, which the
// standalone -version check can't rule out either way.
//
// Rather than have ffmpeg negotiate the HTTPS connection to Vercel Blob
// directly, download the track to a local temp file first (using Node's
// own fetch, which has no history of segfaulting) and point ffmpeg at that
// local path instead. This removes an entire class of failure modes
// (redirects, chunked transfer, TLS handshake quirks, connection resets)
// from ffmpeg's job, leaving it to do only what it's given a clean local
// file to do: decode. If this fixes the crash, it confirms the bug was in
// ffmpeg's own network fetch path, not the file's content or a general
// binary problem - if it still segfaults from a local file, that instead
// points at the actual audio content/encoding as the next thing to check.
async function downloadToTemp(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "erendyl-track-"));
  const filePath = join(dir, "track.mp3");
  await writeFile(filePath, buffer);
  return filePath;
}

export function playTrackInChannel(channel: VoiceBasedChannel, url: string, retryCount = 0): void {
  // (2026-07-08) Log every call so a duplicate/double-fired interaction
  // (e.g. a select-menu handler running twice) shows up as two of these
  // lines for what should be one user action - ruling out "two competing
  // players stealing the same connection subscription" as a cause of the
  // still-unexplained early cutoffs.
  console.log(`[voice] playTrackInChannel called (guild=${channel.guild.id}, retryCount=${retryCount}, url=${url})`);
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

  // (2026-07-09) Download-then-decode, not stream-and-decode - see
  // downloadToTemp's comment above. This is why the rest of this function
  // has to run inside an async block: joining the voice channel and wiring
  // up its listeners above stays synchronous (so a second call for the same
  // guild while a download is in flight still finds/reuses the connection),
  // but ffmpeg can't start until the file is actually on disk. Capturing
  // `connection` in a local const before the closure keeps TypeScript's
  // narrowing (it can't narrow a `let` inside a nested function, since the
  // outer variable could theoretically be reassigned before the closure runs).
  const activeConnection = connection;
  void (async () => {
    let localPath: string | null = null;
    let sourceForFfmpeg = url;
    try {
      localPath = await downloadToTemp(url);
      sourceForFfmpeg = localPath;
      console.log(`[voice] downloaded track to local temp file (${localPath}), handing that to ffmpeg instead of the remote URL`);
    } catch (err) {
      console.error(
        `[voice] track download failed, falling back to letting ffmpeg fetch the URL directly (may reproduce the SIGSEGV):`,
        (err as Error).message,
      );
    }

    const player = createAudioPlayer();
    // prism.FFmpeg is itself the readable stream to consume - it has no
    // separate .output property (that was a mistaken assumption).
    const ffmpegStream = transcode(sourceForFfmpeg);

    const cleanupTempFile = () => {
      if (localPath) {
        void rm(localPath, { force: true, recursive: true }).catch(() => {});
      }
    };

    // (2026-07-08) prism-media's FFmpeg wrapper only ever reads process.stdout
    // (the actual audio) - it never touches process.stderr, so the earlier
    // "-loglevel error" change never actually surfaced anything: ffmpeg's own
    // diagnostic output was going into an unread pipe the whole time. This is
    // the real reason "Now playing" -> near-instant "Idle" gave us zero clues.
    // Reading stderr ourselves is the only way to see whether ffmpeg is
    // hitting a genuine error (unsupported format, bad local file, etc.)
    // versus a track that's just legitimately short.
    ffmpegStream.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error("[voice] ffmpeg:", text);
    });

    // (2026-07-08) Neither the -re nor the no -re attempt produced any ffmpeg
    // stderr output, yet both cut off after a small fraction of a 2:58 track
    // with no error anywhere - meaning ffmpeg's own process is exiting
    // "successfully" (code 0) having decoded only a tiny amount of audio.
    // These two extra signals narrow down why: the process exit event tells
    // us definitively whether ffmpeg thinks it finished cleanly vs was killed
    // by something (a non-zero/signal exit would point at a crash instead of
    // a truncated-input theory), and the byte counter tells us how much PCM
    // was actually produced - at 48000Hz/16-bit/stereo that's 192,000
    // bytes/sec, so a real 2:58 track fully decoded would be roughly 33.4MB;
    // a suspiciously tiny number here would strongly confirm ffmpeg only
    // ever received a small truncated chunk, rather than genuinely reaching
    // the end of a full decode.
    let pcmBytesReceived = 0;
    ffmpegStream.on("data", (chunk: Buffer) => {
      pcmBytesReceived += chunk.length;
    });
    ffmpegStream.process.on("exit", (code, signal) => {
      console.log(
        `[voice] ffmpeg process exited (code=${code}, signal=${signal}, pcmBytesReceived=${pcmBytesReceived}, source=${localPath ? "local temp file" : "remote URL (download fallback)"})`,
      );
    });

    const resource = createAudioResource(ffmpegStream, { inputType: StreamType.Raw });

    activeConnection.subscribe(player);
    player.play(resource);

    const playbackStartedAt = Date.now();
    player.on(AudioPlayerStatus.Playing, () => console.log("[voice] player state: Playing"));
    player.on(AudioPlayerStatus.Buffering, () => console.log("[voice] player state: Buffering"));
    player.on(AudioPlayerStatus.Idle, () => {
      const elapsedMs = Date.now() - playbackStartedAt;
      console.log(
        `[voice] player state: Idle after ${elapsedMs}ms, pcmBytesReceived=${pcmBytesReceived} (track ended or was cut off)`,
      );
      ffmpegStream.destroy();
      cleanupTempFile();
    });
    player.on("error", (err) => {
      console.error("[voice] playback error:", err.message);
      ffmpegStream.destroy();
      cleanupTempFile();
    });
    ffmpegStream.on("error", (err) => console.error("[voice] ffmpeg stream error:", err.message));
  })();
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
