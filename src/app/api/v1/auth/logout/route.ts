import { bearerToken, revokeToken } from "@/lib/api-auth";
import { json, corsPreflight } from "../../_lib/http";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/logout - revokes the presented token. Idempotent: a
// token that's already gone still gets a 200, the end state is identical.
export async function POST(req: Request) {
  const raw = bearerToken(req);
  if (raw) await revokeToken(raw);
  return json({ ok: true });
}

export function OPTIONS() {
  return corsPreflight();
}
