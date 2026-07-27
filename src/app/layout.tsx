import type { Metadata } from "next";
import localFont from "next/font/local";
import NavBar from "@/components/NavBar";
import "./globals.css";

// "The Official Tome" type, authentic edition (2026-07-27): the community
// CC BY-SA recreations of the actual 5e book faces, self-hosted from
// src/fonts (see src/fonts/README.md for source + license). Bookinsanity
// (= Bookmania) carries body text, Mr Eaves Small Caps carries headings,
// and Nodesto Caps Condensed - the cover-logo face - is reserved for the
// wordmark and hero titles via --font-title.
const mrEaves = localFont({
  src: "../fonts/mr-eaves-small-caps.woff2",
  variable: "--font-display",
  display: "swap",
  fallback: ["Marcellus SC", "Georgia", "serif"],
});

const bookinsanity = localFont({
  src: [
    { path: "../fonts/bookinsanity.woff2", weight: "400", style: "normal" },
    { path: "../fonts/bookinsanity-italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/bookinsanity-bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/bookinsanity-bold-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["Alegreya", "Georgia", "serif"],
});

const nodesto = localFont({
  src: "../fonts/nodesto-caps-condensed.woff2",
  variable: "--font-title",
  display: "swap",
  fallback: ["Marcellus SC", "Georgia", "serif"],
});

export const metadata: Metadata = {
  title: "Erendyl Codex",
  description: "The player-facing chronicle of the world of Erendyl.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mrEaves.variable} ${bookinsanity.variable} ${nodesto.variable}`}>
      <body className="font-body min-h-screen flex flex-col relative">
        <NavBar />
        <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 relative z-10">{children}</main>
        <footer className="border-t border-gold/15 py-6 text-center text-xs tracking-wide text-parchment/40">
          The Erendyl Codex &middot; chronicled by the Dungeon Master
        </footer>
      </body>
    </html>
  );
}
