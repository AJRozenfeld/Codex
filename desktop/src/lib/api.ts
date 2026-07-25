import type {
  CampaignInfo,
  CharacterRef,
  CharacterSheetData,
  ContentSnapshot,
  LiveSheetPatch,
  LiveSheetState,
  PlayerInfo,
} from "./types";

// ---------------------------------------------------------------------------
// Thin client for the Codex /api/v1 JSON API. Auth is a bearer token minted
// at login (see the website's src/lib/api-auth.ts); it lives in localStorage
// alongside the chosen server origin and the last synced content snapshot,
// so the codex opens instantly - and offline - on every launch after the
// first.
// ---------------------------------------------------------------------------

const KEYS = {
  server: "ecx.server",
  token: "ecx.token",
  session: "ecx.session", // { player, campaign, characterId, dmSlug }
  cache: "ecx.cache", // { generatedAt, campaign, content }
  seen: "ecx.seen", // string[] of "type:id" from the previous snapshot
};

export const DEFAULT_SERVER = "https://codex-erendyl.vercel.app";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable - the app still works, just without persistence.
  }
}

export function getServer(): string {
  return storageGet(KEYS.server) ?? DEFAULT_SERVER;
}

export function setServer(origin: string) {
  storageSet(KEYS.server, origin.replace(/\/+$/, ""));
}

export function getToken(): string | null {
  return storageGet(KEYS.token);
}

export interface StoredSession {
  player: PlayerInfo;
  campaign: CampaignInfo | null;
  characterId: string | null;
  dmSlug: string | null;
}

export function getStoredSession(): StoredSession | null {
  const raw = storageGet(KEYS.session);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface StoredCache {
  generatedAt: string;
  campaign: CampaignInfo | null;
  content: ContentSnapshot;
}

export function getStoredCache(): StoredCache | null {
  const raw = storageGet(KEYS.cache);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getSeenIds(): Set<string> {
  const raw = storageGet(KEYS.seen);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function persistCache(cache: StoredCache, seen: Set<string>) {
  storageSet(KEYS.cache, JSON.stringify(cache));
  storageSet(KEYS.seen, JSON.stringify([...seen]));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(getServer() + path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Could not reach the Codex. Check your connection.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error body - fall through with the status alone.
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export interface LoginResult {
  token: string;
  player: PlayerInfo;
  campaign: CampaignInfo | null;
  characterId: string | null;
  dm: { slug: string; name: string | null } | null;
}

export async function login(
  server: string,
  dmSlug: string | null,
  username: string,
  password: string
): Promise<LoginResult> {
  setServer(server);
  const result = await request<LoginResult>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      dmSlug: dmSlug || undefined,
      username,
      password,
      deviceLabel: "Companion app",
    }),
  });
  storageSet(KEYS.token, result.token);
  const session: StoredSession = {
    player: result.player,
    campaign: result.campaign,
    characterId: result.characterId,
    dmSlug: dmSlug,
  };
  storageSet(KEYS.session, JSON.stringify(session));
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // Best effort - clear locally regardless.
  }
  storageSet(KEYS.token, null);
  storageSet(KEYS.session, null);
  storageSet(KEYS.cache, null);
  storageSet(KEYS.seen, null);
}

export interface MeResult {
  player: PlayerInfo;
  campaign: CampaignInfo | null;
  character: CharacterRef | null;
}

export function fetchMe(): Promise<MeResult> {
  return request<MeResult>("/api/v1/me");
}

export interface ContentResult {
  assigned: boolean;
  campaign: CampaignInfo | null;
  generatedAt: string;
  content: ContentSnapshot | null;
}

export function fetchContent(): Promise<ContentResult> {
  return request<ContentResult>("/api/v1/content");
}

export interface SheetResult {
  characterId: string;
  characterName: string;
  portraitPath: string | null;
  sheet: CharacterSheetData;
}

export function fetchSheet(): Promise<SheetResult> {
  return request<SheetResult>("/api/v1/sheet");
}

export function patchSheet(patch: LiveSheetPatch): Promise<{ live: LiveSheetState }> {
  return request<{ live: LiveSheetState }>("/api/v1/sheet", {
    method: "PATCH",
    body: JSON.stringify({ patch }),
  });
}

export function requestRoll(target: string): Promise<{ ok: boolean; error?: string }> {
  return request<{ ok: boolean; error?: string }>("/api/v1/roll", {
    method: "POST",
    body: JSON.stringify({ target }),
  });
}

/** Resolves a server-relative asset path (portraits, artifact art) against
 *  the configured server origin. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return getServer() + (path.startsWith("/") ? path : `/${path}`);
}
