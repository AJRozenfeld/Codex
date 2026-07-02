import { NextResponse, type NextRequest } from "next/server";
import { getIronSession, type SessionOptions } from "iron-session";
import { sessionOptions, type AdminSessionData } from "@/lib/auth";

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

  if (pathname === "/login") {
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
