import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0d0b10",
        "ink-raised": "#19151c",
        parchment: "#e9dfc7",
        ember: "#c77c3f",
        gold: "#c9a84c",
        "gold-dim": "#8a7233",
        blood: "#7a2b2b",
        void: "#171320",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "serif"],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(201,168,76,0.09), 0 10px 30px -14px rgba(0,0,0,0.7)",
        "card-hover": "inset 0 1px 0 0 rgba(201,168,76,0.22), 0 16px 36px -12px rgba(0,0,0,0.75)",
        glow: "0 0 0 1px rgba(201,168,76,0.35), 0 0 24px -2px rgba(201,168,76,0.35)",
      },
      letterSpacing: {
        wider2: "0.14em",
      },
    },
  },
  plugins: [],
};
export default config;
