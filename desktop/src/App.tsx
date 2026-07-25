import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import Titlebar from "./components/Titlebar";
import Login from "./components/Login";
import HomeView from "./components/HomeView";
import ListView, { TYPE_META } from "./components/ListView";
import DetailView from "./components/DetailView";
import TimelineView from "./components/TimelineView";
import SheetView from "./components/SheetView";
import { DiceProvider } from "./components/DiceOverlay";
import { useApp, type EntityType, type View } from "./lib/store";

function viewKey(v: View): string {
  switch (v.name) {
    case "home":
      return "home";
    case "timeline":
      return "timeline";
    case "sheet":
      return "sheet";
    case "list":
      return `list:${v.type}`;
    case "detail":
      return `detail:${v.type}:${v.id}`;
  }
}

function NavItem({
  label,
  active,
  count,
  hasNew,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  hasNew?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between rounded px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-gold/15 text-gold border border-gold/30" : "text-parchment/60 hover:text-gold hover:bg-gold/5 border border-transparent"
      }`}
    >
      <span className="flex items-center gap-2">
        {label}
        {hasNew && <span className="glint w-1.5 h-1.5 rounded-full bg-gold" />}
      </span>
      {count !== undefined && <span className="text-[10px] text-parchment/30 tabular-nums">{count}</span>}
    </button>
  );
}

function Shell() {
  const { view, navigate, content, campaign, player, characterId, newIds, syncing, sync, logout, assigned } = useApp();

  const counts = useMemo(() => {
    const c = content;
    return {
      characters: c?.characters.length ?? 0,
      regions: c?.regions.length ?? 0,
      locations: c?.locations.length ?? 0,
      factions: c?.factions.length ?? 0,
      storylines: c?.storylines.length ?? 0,
      artifacts: c?.artifacts.length ?? 0,
      moons: c?.moons.length ?? 0,
      sections: c?.sections.length ?? 0,
    };
  }, [content]);

  const hasNew = (type: EntityType) => [...newIds].some((id) => id.startsWith(`${type}:`));
  const navTypes: EntityType[] = ["characters", "regions", "locations", "factions", "storylines", "artifacts"];

  if (!assigned) {
    return (
      <div className="flex-1 grid place-items-center relative z-10 p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 w-4 h-4 rotate-45 bg-gold/60" />
          <h1 className="font-display text-2xl text-gold mb-3">Await your summons</h1>
          <p className="text-sm text-parchment/60 leading-relaxed">
            You're registered at your DM's table, but haven't been placed in a campaign yet. The moment your DM seats
            you, the Codex will open here on its own.
          </p>
          <button onClick={() => void sync()} className="mt-6 text-xs text-parchment/40 hover:text-gold">
            {syncing ? "checking…" : "check again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 relative z-10">
      {/* sidebar */}
      <aside className="w-56 flex-none border-r border-gold/10 bg-ink/60 backdrop-blur flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <div className="font-display text-gold text-sm truncate">{campaign?.name ?? "The Codex"}</div>
          <div className="divider-rule mt-3" />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <NavItem label="Hearth" active={view.name === "home"} onClick={() => navigate({ name: "home" })} />
          <NavItem
            label="Timeline"
            active={view.name === "timeline"}
            hasNew={hasNew("sections") ? false : [...newIds].some((id) => id.startsWith("timeline:"))}
            onClick={() => navigate({ name: "timeline" })}
          />
          {characterId && (
            <NavItem label="My Character" active={view.name === "sheet"} onClick={() => navigate({ name: "sheet" })} />
          )}
          <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-wider2 text-ember/70">The World</div>
          {navTypes.map((t) => (
            <NavItem
              key={t}
              label={TYPE_META[t].title}
              count={counts[t]}
              hasNew={hasNew(t)}
              active={(view.name === "list" || view.name === "detail") && view.type === t}
              onClick={() => navigate({ name: "list", type: t })}
            />
          ))}
          {counts.moons > 0 && (
            <NavItem
              label="The Moons"
              count={counts.moons}
              hasNew={hasNew("moons")}
              active={(view.name === "list" || view.name === "detail") && view.type === "moons"}
              onClick={() => navigate({ name: "list", type: "moons" })}
            />
          )}
          {counts.sections > 0 && (
            <NavItem
              label="Lore"
              count={counts.sections}
              hasNew={hasNew("sections")}
              active={(view.name === "list" || view.name === "detail") && view.type === "sections"}
              onClick={() => navigate({ name: "list", type: "sections" })}
            />
          )}
        </nav>
        <div className="p-3 border-t border-gold/10">
          <div className="text-xs text-parchment/60 truncate">{player?.displayName ?? player?.username}</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void sync()}
              disabled={syncing}
              className="flex-1 rounded border border-gold/25 px-2 py-1 text-[11px] text-parchment/60 hover:text-gold hover:border-gold/50 disabled:opacity-50"
            >
              {syncing ? "syncing…" : "sync"}
            </button>
            <button
              onClick={() => void logout()}
              className="rounded border border-gold/15 px-2 py-1 text-[11px] text-parchment/40 hover:text-blood hover:border-blood/40"
            >
              leave
            </button>
          </div>
        </div>
      </aside>

      {/* content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={viewKey(view)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="px-8 py-8 max-w-5xl mx-auto"
          >
            {view.name === "home" && <HomeView />}
            {view.name === "timeline" && <TimelineView />}
            {view.name === "sheet" && <SheetView />}
            {view.name === "list" && <ListView type={view.type} />}
            {view.name === "detail" && <DetailView type={view.type} id={view.id} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  const { booted, loggedIn } = useApp();
  return (
    <DiceProvider>
      <div className="h-full flex flex-col">
        <Titlebar />
        {!booted ? (
          <div className="flex-1 grid place-items-center">
            <div className="w-4 h-4 rotate-45 bg-gold/50 animate-pulse" />
          </div>
        ) : loggedIn ? (
          <Shell />
        ) : (
          <Login />
        )}
      </div>
    </DiceProvider>
  );
}
