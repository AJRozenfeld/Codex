import type { Metadata } from "next";
import { Cinzel, Lora } from "next/font/google";
import NavBar from "@/components/NavBar";
import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
    <html lang="en" className={`${cinzel.variable} ${lora.variable}`}>
      <body className="font-body min-h-screen flex flex-col relative">
        <NavBar />
        <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 relative z-10">{children}</main>
        <footer className="border-t border-gold/10 py-6 text-center text-xs tracking-wide text-parchment/30">
          The Erendyl Codex &middot; chronicled by the Dungeon Master
        </footer>
      </body>
    </html>
  );
}
