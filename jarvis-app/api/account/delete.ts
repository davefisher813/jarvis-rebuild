// SHELL-F-03 (2026-09-05): the endpoint Settings > Account > Delete Account
// has been calling since S3-Q18. It did not exist, so the armed two-tap ended
// in "Couldn't delete your account (404)" every time, on a device whose
// Privacy Policy promises deletion and in an app the App Store will not
// approve without it.
//
// Same shape as the other privileged endpoints here (api/ai.ts, api/_admin.ts):
// edge runtime, the caller's own Supabase JWT verified against /auth/v1/user
// with the anon key, then the service-role key for the work. It deletes ONLY
// the caller's own account: there is no id in the request, and the id used is
// the one Supabase returns for that token, so this endpoint cannot be pointed
// at anybody else.
//
// The sequence itself lives in src/account/deleteAccount.ts, where the tests
// and the typechecker can reach it (api/ is in neither).
export const config = { runtime: "edge" };

import { deleteAccountEverywhere, type FetchLike } from "../../src/account/deleteAccount";

// The native build posts from capacitor://localhost, a different origin from
// this API, so the browser sends a preflight first. Answering it is what lets
// the tap from the phone land at all (same reason as api/client-error.ts).
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  // UP-LAUNCH-06 (2026-09-05): the key the stored Google refresh tokens are
  // encrypted with, so they can be handed back to Google rather than merely
  // dropped from our database. Optional: a project with no Google connection
  // configured deletes exactly as before.
  const tokenKey = process.env.GOOGLE_TOKEN_KEY || "";
  // Said plainly rather than as a 500 with no shape: without the service-role
  // key this endpoint cannot delete anything, and the person tapping it needs
  // to know that nothing happened.
  if (!url || !anon || !serviceKey) return json({ error: "Account deletion is not configured on the server" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!who.ok) return json({ error: "Unauthorized" }, 401);
  const me = (await who.json()) as { id?: string };
  if (!me.id) return json({ error: "Unauthorized" }, 401);

  try {
    const { files, revoked, revokeFailed } = await deleteAccountEverywhere(
      { url, serviceKey, ...(tokenKey ? { tokenKey } : {}) },
      me.id,
      fetch as unknown as FetchLike,
    );
    // One line per deletion, in the function log, so "did that account
    // actually go" is a log search and not a guess. The id only: what was in
    // the account is exactly what this endpoint just erased. A Google grant
    // that would not revoke is named here because it is the one part of this
    // that another company still holds afterwards.
    console.log("[jarvis-account-delete]", me.id, "files:", files, "google revoked:", revoked, "google failed:", revokeFailed);
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not delete the account";
    console.error("[jarvis-account-delete-failed]", me.id, msg);
    return json({ error: msg }, 502);
  }
}
