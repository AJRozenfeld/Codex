import { useCallback } from "react";
import { useApp } from "../lib/store";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function windowAction(action: "minimize" | "maximize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "maximize") await w.toggleMaximize();
  else await w.close();
}

// Custom titlebar: the native frame is off (decorations:false) so the whole
// window wears the Codex's colors. The bar is the drag region; buttons and
// status opt out of dragging.
export default function Titlebar() {
  const { syncing, offline, lastSyncedAt, loggedIn } = useApp();
  const minimize = useCallback(() => void windowAction("minimize"), []);
  const maximize = useCallback(() => void windowAction("maximize"), []);
  const close = useCallback(() => void windowAction("close"), []);

  return (
    <div className="drag-region relative z-30 flex items-center h-9 px-3 border-b border-gold/15 bg-ink/80 backdrop-blur select-none">
      <div className="flex items-center gap-2 text-gold">
        <span className="inline-block w-2 h-2 rotate-45 bg-gold" />
        <span className="font-display text-xs tracking-wider2 uppercase">Erendyl Codex</span>
      </div>
      <div className="flex-1" />
      {loggedIn && (
        <div className="no-drag mr-3 text-[11px] text-parchment/40 tabular-nums">
          {syncing ? (
            <span className="text-gold/80">syncing…</span>
          ) : offline ? (
            <span className="text-blood">offline — showing your last synced codex</span>
          ) : lastSyncedAt ? (
            <span>synced {new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          ) : null}
        </div>
      )}
      {isTauri && (
        <div className="no-drag flex items-center gap-1">
          <button
            onClick={minimize}
            aria-label="Minimize"
            className="w-8 h-6 grid place-items-center text-parchment/50 hover:text-gold hover:bg-gold/10 rounded"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button
            onClick={maximize}
            aria-label="Maximize"
            className="w-8 h-6 grid place-items-center text-parchment/50 hover:text-gold hover:bg-gold/10 rounded"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="w-8 h-6 grid place-items-center text-parchment/50 hover:text-parchment hover:bg-blood/60 rounded"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
