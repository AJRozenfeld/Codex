import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import type { CampaignInfo, ContentSnapshot, PlayerInfo } from "./types";

// ---------------------------------------------------------------------------
// App-wide state: who's logged in, the cached content snapshot, sync status,
// and which entities are newly revealed since the previous sync (the app's
// "the DM has unveiled something" moment).
// ---------------------------------------------------------------------------

export type EntityType =
  | "regions"
  | "locations"
  | "characters"
  | "factions"
  | "storylines"
  | "artifacts"
  | "moons"
  | "sections";

export type View =
  | { name: "home" }
  | { name: "list"; type: EntityType }
  | { name: "detail"; type: EntityType; id: string }
  | { name: "timeline" }
  | { name: "sheet" };

interface AppState {
  booted: boolean;
  loggedIn: boolean;
  player: PlayerInfo | null;
  campaign: CampaignInfo | null;
  characterId: string | null;
  content: ContentSnapshot | null;
  assigned: boolean;
  newIds: Set<string>;
  syncing: boolean;
  offline: boolean;
  lastSyncedAt: string | null;
  view: View;
  navigate: (v: View) => void;
  back: () => void;
  login: (server: string, dmSlug: string | null, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  sync: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

function snapshotIds(content: ContentSnapshot): Set<string> {
  const ids = new Set<string>();
  const add = (type: string, list: { id: string }[]) => list.forEach((e) => ids.add(`${type}:${e.id}`));
  add("regions", content.regions);
  add("locations", content.locations);
  add("characters", content.characters);
  add("factions", content.factions);
  add("storylines", content.storylines);
  add("artifacts", content.artifacts);
  add("timeline", content.timeline);
  add("moons", content.moons);
  add("sections", content.sections);
  return ids;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [content, setContent] = useState<ContentSnapshot | null>(null);
  const [assigned, setAssigned] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "home" });
  const historyRef = useRef<View[]>([]);
  const loggedIn = player !== null;

  const sync = useCallback(async () => {
    if (!api.getToken()) return;
    setSyncing(true);
    try {
      const [me, result] = await Promise.all([api.fetchMe(), api.fetchContent()]);
      setPlayer(me.player);
      setCampaign(result.campaign ?? me.campaign);
      setCharacterId(me.character?.id ?? null);
      setAssigned(result.assigned);
      if (result.assigned && result.content) {
        const currentIds = snapshotIds(result.content);
        const seen = api.getSeenIds();
        // First-ever sync: everything is "new" only in the boring sense -
        // no badges, just remember what we saw.
        const fresh =
          seen.size === 0 ? new Set<string>() : new Set([...currentIds].filter((id) => !seen.has(id)));
        setNewIds(fresh);
        setContent(result.content);
        setLastSyncedAt(result.generatedAt);
        api.persistCache(
          { generatedAt: result.generatedAt, campaign: result.campaign, content: result.content },
          currentIds
        );
      }
      setOffline(false);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        // Token revoked or player deleted - drop to the login screen.
        await api.logout();
        setPlayer(null);
        setContent(null);
      } else {
        setOffline(true);
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  // Boot: restore session + cache from disk, then refresh in the background.
  useEffect(() => {
    const session = api.getStoredSession();
    const cache = api.getStoredCache();
    if (session && api.getToken()) {
      setPlayer(session.player);
      setCampaign(cache?.campaign ?? session.campaign);
      setCharacterId(session.characterId);
      if (cache) {
        setContent(cache.content);
        setLastSyncedAt(cache.generatedAt);
      }
      void sync();
    }
    setBooted(true);
  }, [sync]);

  // Gentle auto-refresh so mid-session reveals arrive without anyone
  // touching anything. 3 minutes is one lightweight request - far kinder
  // than a browser tab being refreshed all night.
  useEffect(() => {
    if (!loggedIn) return;
    const t = setInterval(() => void sync(), 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [loggedIn, sync]);

  const login = useCallback(
    async (server: string, dmSlug: string | null, username: string, password: string) => {
      const result = await api.login(server, dmSlug, username, password);
      setPlayer(result.player);
      setCampaign(result.campaign);
      setCharacterId(result.characterId);
      setView({ name: "home" });
      historyRef.current = [];
      await sync();
    },
    [sync]
  );

  const logout = useCallback(async () => {
    await api.logout();
    setPlayer(null);
    setCampaign(null);
    setCharacterId(null);
    setContent(null);
    setNewIds(new Set());
    setView({ name: "home" });
    historyRef.current = [];
  }, []);

  const navigate = useCallback((v: View) => {
    setView((prev) => {
      historyRef.current = [...historyRef.current.slice(-24), prev];
      return v;
    });
  }, []);

  const back = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev) setView(prev);
    else setView({ name: "home" });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      booted,
      loggedIn,
      player,
      campaign,
      characterId,
      content,
      assigned,
      newIds,
      syncing,
      offline,
      lastSyncedAt,
      view,
      navigate,
      back,
      login,
      logout,
      sync,
    }),
    [booted, loggedIn, player, campaign, characterId, content, assigned, newIds, syncing, offline, lastSyncedAt, view, navigate, back, login, logout, sync]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
