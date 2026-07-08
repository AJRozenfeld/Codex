import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Client-side (direct-to-Blob) upload handshake for music tracks (2026-07-07).
// The plain server-action upload in /admin/music went through Next.js's
// Server Actions body limit (4mb, see next.config.mjs) - fine for portrait/
// map images, but real audio files routinely exceed that, so the upload
// silently failed before uploadAction's own code ever ran (same class of bug
// as the campaign-import zip issue). The browser now uploads the file bytes
// straight to Vercel Blob using a short-lived client token from this route,
// entirely bypassing our server's body-size limit; only the resulting blob
// URL (a few dozen bytes) is ever sent through a server action afterward.
// ---------------------------------------------------------------------------

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
];

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        if (!(await isAdminAuthed())) {
          throw new Error("Not authorized.");
        }
        return {
          allowedContentTypes: ALLOWED_AUDIO_TYPES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // No-op: the client calls a lightweight server action with the
        // resulting URL right after this completes, which is what actually
        // writes the music_tracks row.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
