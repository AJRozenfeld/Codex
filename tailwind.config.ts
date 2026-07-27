import type { Config } from "tailwindcss";

// ---------------------------------------------------------------------------
// "The Old Library" palette (WorldAnvil-inspired redesign, 2026-07-21).
// Warm walnut and leather instead of violet-black; antique bronze instead of
// glowing gold; candlelight instead of neon. The previous identity is frozen
// in design-backups/dark-fantasy-v2/ (tag: design-dark-fantasy-v2).
// Token NAMES are unchanged so every page inherits the shift untouched.
// ---------------------------------------------------------------------------
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#191410",          // warm coffee-black page ground
        "ink-raised": "#282019", // raised dark walnut
        parchment: "#eadfc6",    // aged paper text
        ember: "#c08552",        // terracotta ember
        gold: "#c9a765",         // antique bronze (was glowing gold)
        "gold-dim": "#96773f",
        blood: "#96453b",        // dried-red leather
        void: "#241c15",         // dark leather surface
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "serif"],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(201,167,101,0.08), 0 8px 24px -12px rgba(0,0,0,0.65)",
        "card-hover": "inset 0 1px 0 0 rgba(201,167,101,0.18), 0 14px 30px -10px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(201,167,101,0.30), 0 0 18px -4px rgba(201,167,101,0.28)",
      },
      letterSpacing: {
        wider2: "0.14em",
      },
    },
  },
  plugins: [],
};
export default config;
