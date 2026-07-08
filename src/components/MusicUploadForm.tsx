"use client";

import { useState, useTransition, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Client component (2026-07-07) so the audio file can be uploaded directly
// from the browser to Vercel Blob, instead of through a Server Action's body
// (capped at 4mb - see next.config.mjs and /api/blob/music-upload/route.ts
// for the full "why"). saveTrackAction is a Server Action passed down from
// the (server) page component - only the small {name, tags, fileUrl} payload
// ever crosses back into a Server Action here, never the raw file.
// ---------------------------------------------------------------------------

export function MusicUploadForm({
  saveTrackAction,
}: {
  saveTrackAction: (input: { name: string; tags?: string; fileUrl: string }) => Promise<void>;
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const tags = String(formData.get("tags") ?? "").trim() || undefined;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!name || !file) {
      setError("Name and an audio file are both required.");
      return;
    }

    setIsUploading(true);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob/music-upload",
      });
      await saveTrackAction({ name, tags, fileUrl: blob.url });
      form.reset();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed - please try again.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mb-8 rounded-lg border border-gold/15 p-4">
      {error && <p className="text-sm text-blood">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Name</span>
          <input
            name="name"
            required
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Tags (comma-separated)</span>
          <input
            name="tags"
            placeholder="combat, tense"
            className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">Audio File</span>
        <input
          type="file"
          name="file"
          accept="audio/*"
          required
          className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm file:mr-3 file:rounded-full file:border-0 file:bg-gold/90 file:text-ink file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
      </label>
      <button
        type="submit"
        disabled={isUploading}
        className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold disabled:opacity-50"
      >
        {isUploading ? "Uploading…" : "Upload Track"}
      </button>
    </form>
  );
}
