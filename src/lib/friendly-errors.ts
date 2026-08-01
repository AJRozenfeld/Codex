// ---------------------------------------------------------------------------
// Action-feedback pass (2026-07-31). Server actions that throw (license
// quotas, validation, "can't delete your only campaign") used to surface as
// Next's raw production error page. Wrapped actions catch, and redirect to
// /admin/notice, which shows the message inside the admin chrome with a way
// back. isNextControlError keeps redirect()/notFound() control-flow
// exceptions flowing - swallowing those would break navigation itself.
// ---------------------------------------------------------------------------

export function isNextControlError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/** Build the /admin/notice URL for an error (or a plain message) with a back link. */
export function noticePath(err: unknown, back: string): string {
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
  return `/admin/notice?msg=${encodeURIComponent(msg.slice(0, 500))}&back=${encodeURIComponent(back)}`;
}
