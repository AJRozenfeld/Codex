import type { Config } from "tailwindcss";

// ---------------------------------------------------------------------------
// "Daylight Archive" palette experiment (2026-07-21): light gray paper with
// sky-blue accents, per Aviv. Token NAMES keep their dark-era meanings
// remapped for a light world:
//   ink       -> near-white (text ON accent buttons, input grounds)
//   parchment -> dark slate (the reading text everywhere)
//   void      -> white panel surfaces
//   gold      -> sky blue (the accent)
//   ember     -> steel blue (secondary labels)
// Previous looks frozen in design-backups/ (dark-fantasy-v2, old-library-warm).
// ---------------------------------------------------------------------------
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f5f7f9",          // near-white: button text, input grounds
        "ink-raised": "#e9edf1",
        parchment: "#2d3640",    // dark slate reading text
        ember: "#5d7d99",        // steel-blue secondary labels
        gold: "#4a90c2",         // sky blue accent
        "gold-dim": "#356c96",
        blood: "#b0524a",
        void: "#fdfdfe",         // white panels
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "serif"],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(255,255,255,0.8), 0 8px 22px -12px rgba(45,54,64,0.25)",
        "card-hover": "inset 0 1px 0 0 rgba(255,255,255,0.9), 0 14px 28px -10px rgba(45,54,64,0.3)",
        glow: "0 0 0 1px rgba(74,144,194,0.35), 0 0 16px -4px rgba(74,144,194,0.3)",
      },
      letterSpacing: {
        wider2: "0.14em",
      },
    },
  },
  plugins: [],
};
export default config;
