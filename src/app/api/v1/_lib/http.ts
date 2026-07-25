import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Shared plumbing for the /api/v1 JSON routes (desktop Companion app).
//
// CORS: the Tauri webview fetches from an app-scheme origin
// (http://tauri.localhost on Windows), so every response carries permissive
// CORS headers. This is safe precisely BECAUSE the API is bearer-token
// only - no cookies means no CSRF surface, and a browser can't conjure an
// Authorization header out of thin air. Do not ever add cookie-based auth
// to these routes without revisiting this.
//
// The folder is named _lib so the app router never treats it as a route.
// ---------------------------------------------------------------------------

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function apiError(status: number, message: string): NextResponse {
  return json({ error: message }, status);
}

export function unauthorized(): NextResponse {
  return apiError(401, "Invalid or missing token. Log in again.");
}

/** Every route module re-exports this as OPTIONS so preflights succeed. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Parses a JSON body, returning null (not throwing) on garbage input. */
export async function readJson(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
