"use client";

import { useState, useTransition } from "react";

// The d20 button (roll bridge, 2026-07-16): one click sends this stat's
// roll to the campaign's Discord server via the shared roll_requests queue.
// States: idle die -> spinning -> a brief golden flash on success (the roll
// itself appears in Discord, not here) -> back to idle. Errors turn the die
// red with the reason in the tooltip.

export function RollButton({
  target,
  label,
  rollAction,
  className = "",
}: {
  target: string;
  label: string;
  rollAction: (target: string) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function click() {
    if (pending) return;
    startTransition(async () => {
      const result = await rollAction(target);
      if (result.ok) {
        setState("sent");
        setError(null);
      } else {
        setState("error");
        setError(result.error ?? "Roll failed.");
      }
      setTimeout(() => setState("idle"), 2500);
    });
  }

  const color =
    state === "error" ? "text-red-400 border-red-400/60" :
    state === "sent" ? "text-gold border-gold shadow-glow" :
    "text-parchment/50 border-gold/30 hover:text-gold hover:border-gold/70";

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      title={
        state === "error" ? `${error}` :
        state === "sent" ? `${label} roll sent to Discord!` :
        `Roll ${label} on Discord`
      }
      aria-label={`Roll ${label} on Discord`}
      className={`inline-flex items-center justify-center h-6 w-6 rounded border bg-void/60 transition-all ${color} ${pending ? "animate-pulse" : ""} ${className}`}
    >
      {/* a d20: hexagonal silhouette with inner triangle facets */}
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" />
        <path d="M12 2 L7 10.5 L12 22 M12 2 L17 10.5 L12 22 M7 10.5 L17 10.5 M3 7 L7 10.5 M21 7 L17 10.5 M3 17 L7 10.5 M21 17 L17 10.5" strokeWidth="0.9" opacity="0.7" />
      </svg>
    </button>
  );
}
