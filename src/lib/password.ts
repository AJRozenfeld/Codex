import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight password hashing for player accounts, using Node's built-in
// scrypt (no external dependency like bcrypt needed). Format stored in the
// database: "<salt-hex>:<hash-hex>".
// ---------------------------------------------------------------------------

const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const hash = scryptSync(plain, salt, KEY_LENGTH);
  const storedHash = Buffer.from(hashHex, "hex");
  if (hash.length !== storedHash.length) return false;
  return timingSafeEqual(hash, storedHash);
}
