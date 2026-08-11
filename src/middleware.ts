import { NextResponse, type NextRequest } from "next/server";
import { getIronSession, type SessionOptions } from "iron-session";
import { sessionOptions, masterSessionOptions, type AdminSessionData, type MasterSessionData } from "@/lib/auth";

// Player sessions reuse the admin session's secret/cookie settings under a
// different cookie name - duplicated here rather than imported from
// player-session.ts, because that file imports db.ts, which reads
// schema.sql off disk via Node's fs/path and cannot be bundled into this
// Edge Runtime middleware (see the equivalent note in auth.ts).
const playerSessionOptions: SessionOptions = {
  ...sessionOptions,
  cookieName: "erendyl_player_session",
};

interface PlayerSessionData {
  playerId?: string;
}

// Guards the whole site: /admin/* requires a DM session, everything else
// requires a player session. No anonymous browsing anywhere (Aviv's call -
// "require login always").
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The JSON API (desktop Companion app) authenticates every request itself
  // via bearer tokens (see lib/api-auth.ts) and must return 401s, never
  // login-page redirects - a native client can't follow those anywhere.
  if (pathname.startsWith("/api/v1")) {
    return NextResponse.next();
  }

  // The Blob client-upload handshake (music uploads) authenticates itself
  // inside the route (isAdminAuthed) and must return JSON, never a login
  // redirect: the DM holds an ADMIN session, not a player one, so the
  // player catch-all below was bouncing the token request to the login
  // page - the @vercel/blob client then surfaced the HTML as "Failed to
  // retrieve the client token". A silent regression of the whole-site
  // login gate (2026-07-25), caught 2026-08-09. Vercel's server-to-server
  // onUploadCompleted callback (no cookies at all) needs this exemption
  // just the same.
  if (pathname.startsWith("/api/blob")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      return NextResponse.next();
    }
    const response = NextResponse.next();
    const session = await getIronSession<AdminSessionData>(request, response, sessionOptions);
    if (!session.isAdmin) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return response;
  }

  // Master (license-issuer) area - its own session, own login page.
  if (pathname.startsWith("/master")) {
    if (pathname === "/master/login") {
      return NextResponse.next();
    }
    const response = NextResponse.next();
    const master = await getIronSession<MasterSessionData>(request, response, masterSessionOptions);
    if (!master.isMaster) {
      return NextResponse.redirect(new URL("/master/login", request.url));
    }
    return response;
  }

  // Public entry points: player login (global + per-DM), player
  // self-registration links, and DM license-claim links.
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/claim/")
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const playerSession = await getIronSession<PlayerSessionData>(request, response, playerSessionOptions);
  if (!playerSession.playerId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
