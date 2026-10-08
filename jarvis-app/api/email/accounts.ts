// THE MAILBOXES THE PERSON CONNECTED, MIRRORED INTO THE CACHE'S ACCOUNT ROWS
// (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E21, 09 M9).
// Connecting, reconnecting and forgetting a Google account stay where they
// are (Settings > Connections, api/google.ts); this door only makes sure
// every stored sign-in has its email_account row, and marks the rows whose
// sign-in is gone as disconnected, so the Email tab's account picker and
// freshness line read the truth. The person then reads the rows through
// email_accounts() with their own session.
export const config = { runtime: "edge" };

import { authedUser, failResponse, fail, json, readEnv, serviceRpc, serviceSelect } from "../_email";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);

  const stored = await serviceSelect<{ email: string }>(env, "google_tokens", `user_id=eq.${who.id}&select=email`);
  if (stored === null) return failResponse(fail("UNAVAILABLE"));
  const emails = new Set(stored.map((r) => r.email.toLowerCase()));
  const mirrored: string[] = [];
  for (const email of emails) {
    const r = await serviceRpc(env, "email_account_upsert", { p_owner: who.id, p_address: email, p_scopes: [], p_capabilities: { archive: true, trash: true, read: true } });
    if (!r.error) mirrored.push(email);
  }
  // Rows whose sign-in is gone: disconnected, cache and approved records kept.
  // A revoked grant deletes its stored sign-in but is NOT a forgotten account: it stays reauth_required, with its cached
  // mail and drafts, until the person reconnects or forgets it (0055). Only a row that is still "connected" yet has no
  // sign-in at all (the person forgot it somewhere that did not tell us) is closed here.
  const existing = await serviceSelect<{ id: string; address: string; state: string; auth_state: string }>(env, "email_account", `owner_id=eq.${who.id}&select=id,address,state,auth_state`);
  const disconnected: string[] = [];
  for (const row of existing ?? []) {
    if (!emails.has(row.address) && row.state !== "disconnected" && row.auth_state !== "reauth_required" && row.auth_state !== "paused_by_user") {
      const r = await serviceRpc(env, "email_account_state", { p_owner: who.id, p_account: row.id, p_state: "disconnected", p_error: null });
      if (!r.error) disconnected.push(row.address);
    }
  }
  return json({ ok: true, mirrored, disconnected });
}
