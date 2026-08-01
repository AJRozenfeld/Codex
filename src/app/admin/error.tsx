"use client";

// Segment error boundary: the net under everything the action-feedback pass
// didn't wrap explicitly. Production redacts server error messages, so this
// stays generic - but it keeps the DM inside the admin chrome with a retry,
// instead of Next's bare "Application error" page.
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl mx-auto text-center py-10">
      <div className="text-3xl mb-4" aria-hidden>&#9888;</div>
      <h1 className="font-display text-2xl text-gold mb-4">Something needs attention</h1>
      <p className="rounded-lg border border-blood/40 bg-blood/10 px-5 py-4 text-parchment/80 mb-8">
        The last action couldn&apos;t be completed - most often a license limit or a required field.
        Your existing content is untouched.
      </p>
      <button onClick={reset} className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold">
        Try again
      </button>
    </div>
  );
}
