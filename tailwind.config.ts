import type { Config } from "tailwindcss";

// ---------------------------------------------------------------------------
// "The Official Tome" (2026-07-21): the 5e rulebook page itself. Soft
// parchment ground, near-black body text, deep brick-red display headings
// (the books' heading red), thin red rules, warm brown labels. Token names
// keep their historical meanings remapped:
//   parchment -> near-black reading text
//   gold      -> the books' dark red (headings, rules, buttons)
//   ember     -> warm brown small-caps labels
//   void      -> lighter parchment panels
//   ink       -> cream (text on red buttons, input grounds)
// Frozen predecessors: design-backups/{dark-fantasy-v2, old-library-warm,
// daylight-archive}.
// ---------------------------------------------------------------------------
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#fbf5e2",          // cream: button text, input grounds
        "ink-raised": "#efe6cc",
        parchment: "#1e1a14",    // near-black text
        ember: "#7d5a37",        // warm brown labels
        gold: "#6e1f14",         // the books' dark red
        "gold-dim": "#4f1810",
        blood: "#9c3f35",
        void: "#faf3df",         // parchment panels
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "serif"],
        title: ["var(--font-title)", "serif"],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(255,252,240,0.7), 0 6px 18px -10px rgba(90,60,30,0.35)",
        "card-hover": "inset 0 1px 0 0 rgba(255,252,240,0.85), 0 10px 24px -8px rgba(90,60,30,0.4)",
        glow: "0 0 0 1px rgba(110,31,20,0.3), 0 0 14px -4px rgba(110,31,20,0.25)",
      },
      letterSpacing: {
        wider2: "0.14em",
      },
    },
  },
  plugins: [],
};
export default config;
