import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ApiError } from "../lib/api";

// ---------------------------------------------------------------------------
// The dice moment. Rolls resolve on Discord (the bridge does the math where
// the whole table can see it) - the app's job is to make pressing the button
// FEEL like hurling a die: a d20 tumbles up out of the button press, spins,
// and settles with a gold flash and a "the die is cast" note. Errors (no
// linked server, deleted action) surface as a toast in the same spot.
// ---------------------------------------------------------------------------

interface DiceApi {
  castDie: (label: string, roll: () => Promise<{ ok: boolean; error?: string }>) => void;
  toast: (message: string, tone?: "gold" | "blood") => void;
}

const Ctx = createContext<DiceApi | null>(null);

export function useDice(): DiceApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDice outside DiceProvider");
  return ctx;
}

interface ToastState {
  id: number;
  message: string;
  tone: "gold" | "blood";
}

export function DiceProvider({ children }: { children: React.ReactNode }) {
  const [rolling, setRolling] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: "gold" | "blood" = "gold") => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const castDie = useCallback(
    (label: string, roll: () => Promise<{ ok: boolean; error?: string }>) => {
      setRolling(label);
      const started = Date.now();
      const settle = (fn: () => void) => {
        // Let the die finish at least one satisfying tumble either way.
        const wait = Math.max(0, 900 - (Date.now() - started));
        setTimeout(() => {
          setRolling(null);
          fn();
        }, wait);
      };
      roll()
        .then((result) => {
          settle(() => {
            if (result.ok) toast(`${label} — the die is cast. See Discord.`);
            else toast(result.error ?? "The die slipped. Try again.", "blood");
          });
        })
        .catch((e) => {
          settle(() => toast(e instanceof ApiError && e.status !== 0 ? e.message : "Could not reach the Codex.", "blood"));
        });
    },
    [toast]
  );

  return (
    <Ctx.Provider value={{ castDie, toast }}>
      {children}
      <AnimatePresence>
        {rolling && (
          <motion.div
            key="dice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
            className="fixed inset-0 z-50 grid place-items-center bg-ink/60 backdrop-blur-[2px] pointer-events-none"
          >
            <div className="text-center">
              <motion.div
                initial={{ y: 60, rotate: 0, scale: 0.6 }}
                animate={{ y: [60, -30, 0], rotate: 720, scale: 1 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
                className="mx-auto"
              >
                <svg width="92" height="92" viewBox="0 0 100 100" className="drop-shadow-[0_0_18px_rgba(218,185,98,0.5)]">
                  <polygon
                    points="50,4 89,27 89,73 50,96 11,73 11,27"
                    fill="rgba(16,13,10,0.95)"
                    stroke="#dab962"
                    strokeWidth="2.5"
                  />
                  <polygon points="50,4 89,73 11,73" fill="none" stroke="#d1854a" strokeWidth="1.5" />
                  <line x1="50" y1="4" x2="50" y2="30" stroke="#a08544" strokeWidth="1" />
                  <line x1="89" y1="27" x2="50" y2="30" stroke="#a08544" strokeWidth="1" opacity="0.7" />
                  <line x1="11" y1="27" x2="50" y2="30" stroke="#a08544" strokeWidth="1" opacity="0.7" />
                  <text x="50" y="63" textAnchor="middle" fontSize="26" fontFamily="Cinzel, serif" fill="#dab962">
                    20
                  </text>
                </svg>
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="mt-3 font-display text-sm uppercase tracking-wider2 text-gold"
              >
                {rolling}
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={`rounded border px-4 py-2 text-sm shadow-card backdrop-blur bg-ink/90 ${
                t.tone === "blood" ? "border-blood/50 text-blood" : "border-gold/40 text-gold"
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
