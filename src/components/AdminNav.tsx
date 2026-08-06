"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Grouped admin navigation (2026-08-04). The console had grown to 22 flat
// links; they now live under seven headers (Dashboard + six categories),
// organized by what the DM is DOING: World (places), Story (people & plots),
// Library (game content), Play (live-session tools), Players (accounts +
// creation), Codex (site structure). Hover opens on desktop, click/tap
// toggles everywhere; the header of the section you're inside stays lit.
// ---------------------------------------------------------------------------

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const groupActive = (g: NavGroup) => g.items.some((i) => isActive(i.href));

  return (
    <nav ref={navRef} className="flex flex-wrap gap-1 text-sm">
      {groups.map((g) =>
        g.items.length === 1 ? (
          <Link
            key={g.label}
            href={g.items[0].href}
            className={`px-3 py-1.5 rounded-full transition-colors ${groupActive(g) ? "text-gold bg-gold/10" : "text-parchment/70 hover:text-gold"}`}
          >
            {g.label}
          </Link>
        ) : (
          <div
            key={g.label}
            className="relative"
            onMouseEnter={() => setOpen(g.label)}
            onMouseLeave={() => setOpen((o) => (o === g.label ? null : o))}
          >
            <button
              type="button"
              onClick={() => setOpen((o) => (o === g.label ? null : g.label))}
              className={`px-3 py-1.5 rounded-full transition-colors inline-flex items-center gap-1 ${
                groupActive(g) ? "text-gold bg-gold/10" : "text-parchment/70 hover:text-gold"
              }`}
              aria-expanded={open === g.label}
            >
              {g.label}
              <span className={`text-[9px] transition-transform ${open === g.label ? "rotate-180" : ""}`} aria-hidden>▼</span>
            </button>
            {open === g.label && (
              <div className="absolute left-0 top-full z-50 pt-1">
                <div className="min-w-[11rem] rounded-lg border border-gold/25 bg-void shadow-card-hover py-1">
                  {g.items.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      className={`block px-4 py-1.5 transition-colors ${
                        isActive(i.href) ? "text-gold bg-gold/10" : "text-parchment/75 hover:text-gold hover:bg-gold/5"
                      }`}
                    >
                      {i.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </nav>
  );
}
