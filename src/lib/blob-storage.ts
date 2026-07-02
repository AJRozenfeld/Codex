import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Image storage for uploads (map images, character portraits, ...). In
// production (BLOB_READ_WRITE_TOKEN set, i.e. the Vercel Blob store is
// connected - Aviv's choice for hosting images), uploads go to Vercel Blob
// and we store the returned public URL. In local dev without that token,
// uploads fall back to public/uploads/<folder> so the feature still works
// end-to-end without any external account.
// ---------------------------------------------------------------------------

export async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = (path.extname(file.name) || ".png").toLowerCase();
  const filename = `${folder}/${crypto.randomUUID()}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
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
