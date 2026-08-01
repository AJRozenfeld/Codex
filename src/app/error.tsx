"use client";

// Site-wide error boundary (player-facing tone).
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl mx-auto text-center py-16 px-4">
      <div className="text-3xl mb-4" aria-hidden>&#10022;</div>
      <h1 className="font-display text-2xl text-gold mb-4">The page lost its place in the tome</h1>
      <p className="text-parchment/70 mb-8">Something went wrong on our side. Nothing of yours was lost.</p>
      <button onClick={reset} className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold">
        Try again
      </button>
    </div>
  );
}
