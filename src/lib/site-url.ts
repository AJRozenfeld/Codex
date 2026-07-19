// ---------------------------------------------------------------------------
// Canonical site origin for shareable links (2026-07-20).
//
// Why this exists: the join/claim links shown in the admin and master panels
// used to be built from the request's Host header. Browse the panel through
// a Vercel *deployment* URL (codex-git-main-xxxx.vercel.app - reached e.g.
// by clicking a deployment in the Vercel dashboard) and every generated link
// inherited that host - which sits behind Vercel's own Deployment
// Protection login. The first player invited that way hit a Vercel SSO
// screen and "requested access to your deployments" instead of reaching the
// registration page.
//
// Set SITE_URL in Vercel (e.g. https://your-codex.vercel.app - the real
// production domain, no trailing slash needed) and every shareable link is
// pinned to it regardless of which host the panel is being browsed on.
// Without it, the request host remains the fallback - correct in local dev
// and when browsing the production domain itself.
// ---------------------------------------------------------------------------

export function siteOrigin(requestHost: string | null): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) {
    const withProto = configured.startsWith("http") ? configured : `https://${configured}`;
    return withProto.replace(/\/+$/, "");
  }
  const host = requestHost ?? "";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}
