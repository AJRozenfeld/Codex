import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../lib/store";
import { ApiError, DEFAULT_SERVER, getServer } from "../lib/api";

// Accepts either a bare table slug ("aviv") or a pasted login link
// ("https://.../login/aviv") - players will paste whatever their DM sent.
function parseDmSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\/(?:login|join)\/([^/?#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return trimmed.replace(/^\/+|\/+$/g, "");
}

export default function Login() {
  const { login } = useApp();
  const [table, setTable] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServerInput] = useState(getServer());
  const [showAdvanced, setShowAdvanced] = useState(getServer() !== DEFAULT_SERVER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(server.trim() || DEFAULT_SERVER, parseDmSlug(table), username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 grid place-items-center relative z-10 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-sm px-6 py-10"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ rotate: -8, opacity: 0 }}
            animate={{ rotate: 45, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.7, ease: "easeOut" }}
            className="mx-auto mb-4 w-4 h-4 bg-gold"
          />
          <h1 className="font-display text-3xl text-gold tracking-wide">Erendyl Codex</h1>
          <p className="text-sm text-parchment/50 mt-2 italic">The chronicle awaits its reader.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs uppercase tracking-wider2 text-ember/80 mb-1">
              Table link <span className="normal-case text-parchment/40">(optional)</span>
            </span>
            <input
              type="text"
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="paste your DM's login link, or leave blank"
              className="w-full rounded bg-ink-raised/80 border border-gold/20 px-3 py-2 text-sm text-parchment placeholder:text-parchment/25 focus:border-gold/60 outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider2 text-ember/80 mb-1">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              className="w-full rounded bg-ink-raised/80 border border-gold/20 px-3 py-2 text-sm text-parchment focus:border-gold/60 outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider2 text-ember/80 mb-1">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded bg-ink-raised/80 border border-gold/20 px-3 py-2 text-sm text-parchment focus:border-gold/60 outline-none"
            />
          </label>

          {showAdvanced ? (
            <label className="block">
              <span className="block text-xs uppercase tracking-wider2 text-ember/80 mb-1">Codex server</span>
              <input
                type="text"
                value={server}
                onChange={(e) => setServerInput(e.target.value)}
                className="w-full rounded bg-ink-raised/80 border border-gold/20 px-3 py-2 text-sm text-parchment focus:border-gold/60 outline-none"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="text-[11px] text-parchment/30 hover:text-parchment/60"
            >
              advanced: choose server
            </button>
          )}

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-blood bg-blood/10 border border-blood/30 rounded px-3 py-2"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded border border-gold/50 bg-gold/10 py-2.5 font-display text-sm uppercase tracking-wider2 text-gold hover:bg-gold/20 hover:shadow-glow transition-all disabled:opacity-50"
          >
            {busy ? "Opening the Codex…" : "Enter"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
