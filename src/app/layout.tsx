import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Erendyl Codex",
  description: "The player-facing chronicle of the world of Erendyl.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body min-h-screen flex flex-col">
        <NavBar />
        <main className="flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-10">{children}</main>
        <footer className="border-t border-gold/10 py-6 text-center text-xs text-parchment/30">
          The Erendyl Codex &middot; chronicled by the Dungeon Master
        </footer>
      </body>
    </html>
  );
}
