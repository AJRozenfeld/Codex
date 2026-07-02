import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Image storage for uploads (map images, character portraits, ...). In
// production, uploads go to Vercel Blob and we store the returned public
// URL. Vercel Blob stores connected via the dashboard now authenticate with
// short-lived OIDC credentials (VERCEL_OIDC_TOKEN, injected automatically at
// runtime) paired with BLOB_STORE_ID, rather than the older static
// BLOB_READ_WRITE_TOKEN - the @vercel/blob SDK picks whichever credential is
// available on its own, we just need to know a store is connected at all.
// In local dev with neither present, uploads fall back to
// public/uploads/<folder> so the feature still works end-to-end without any
// external account.
// ---------------------------------------------------------------------------

export async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = (path.extname(file.name) || ".png").toLowerCase();
  const filename = `${folder}/${crypto.randomUUID()}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const { put } = await import("@vercel/blob");
    const blob = await put(filename, file, { access: "public" });
    return blob.url;
  }

  const dir = path.join(process.cwd(), "public", "uploads", folder);
  fs.mkdirSync(dir, { recursive: true });
  const localName = `${crypto.randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(dir, localName), buffer);
  return `/uploads/${folder}/${localName}`;
}

export async function uploadMapImage(file: File): Promise<string> {
  return uploadImage(file, "maps");
}

export async function uploadCharacterPortrait(file: File): Promise<string> {
  return uploadImage(file, "portraits");
}
