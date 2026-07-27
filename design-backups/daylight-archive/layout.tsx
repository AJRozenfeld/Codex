import type { Metadata } from "next";
import { Cormorant_Garamond, Alegreya } from "next/font/google";
import NavBar from "@/components/NavBar";
import "./globals.css";

// "The Old Library" type pairing (2026-07-21): Cormorant Garamond for
// display - an elegant, humanist old-style serif that reads like a book
// plate rather than an engraving - and Alegreya for body, a warm literary
// serif designed for long-form reading. (Previously Cinzel + Lora; frozen
// in design-backups/dark-fantasy-v2/.)
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const alegreya = Alegreya({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Erendyl Codex",
  description: "The player-facing chronicle of the world of Erendyl.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${alegreya.variable}`}>
      <body className="font-body min-h-screen flex flex-col relative">
        <NavBar />
        <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 relative z-10">{children}</main>
        <footer className="border-t border-gold/15 py-6 text-center text-xs tracking-wide text-parchment/35">
          The Erendyl Codex &middot; chronicled by the Dungeon Master
        </footer>
      </body>
    </html>
  );
}
