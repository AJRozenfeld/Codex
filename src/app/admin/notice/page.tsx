import Link from "next/link";

export const dynamic = "force-dynamic";

// The friendly landing spot for server-action errors (see
// src/lib/friendly-errors.ts) - a license quota, a validation rule, or any
// other refusal, spoken plainly inside the admin chrome instead of Next's
// raw production error page.
export default function AdminNoticePage({ searchParams }: { searchParams: { msg?: string; back?: string } }) {
  const msg = searchParams.msg || "Something went wrong.";
  const back = searchParams.back && searchParams.back.startsWith("/admin") ? searchParams.back : "/admin";
  return (
    <div className="max-w-xl mx-auto text-center py-10">
      <div className="text-3xl mb-4" aria-hidden>&#9888;</div>
      <h1 className="font-display text-2xl text-gold mb-4">That didn&apos;t go through</h1>
      <p className="rounded-lg border border-blood/40 bg-blood/10 px-5 py-4 text-parchment/80 mb-8">{msg}</p>
      <Link href={back} className="rounded-full bg-gold/90 text-ink px-6 py-2.5 text-sm font-medium hover:bg-gold">
        &larr; Go back
      </Link>
    </div>
  );
}
