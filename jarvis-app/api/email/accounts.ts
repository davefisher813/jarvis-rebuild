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

  // Every stored sign-in, with its lifecycle state when migration 0057 is there (a DEAD one is Google-revoked and kept for audit).
  const stored = (await serviceSelect<{ email: string; state?: string }>(env, "google_tokens", `user_id=eq.${who.id}&select=email,state`))
    ?? (await serviceSelect<{ email: string; state?: string }>(env, "google_tokens", `user_id=eq.${who.id}&select=email`));
  if (stored === null) return failResponse(fail("UNAVAILABLE"));
  const emails = new Set(stored.map((r) => r.email.toLowerCase()));
  const dead = new Set(stored.filter((r) => r.state === "DEAD").map((r) => r.email.toLowerCase()));
  const existing = await serviceSelect<{ id: string; address: string; state: string }>(env, "email_account", `owner_id=eq.${who.id}&select=id,address,state`);
  const mirrored: string[] = [];
  const reauth: string[] = [];
  for (const email of emails) {
    const row = existing?.find((r) => r.address === email);
    if (dead.has(email)) {
      // A DEAD sign-in is never made "connected" again by being listed. The mailbox is shown as needing reconnection, with its
      // cache and approved records kept; the person's reconnect writes a fresh VALID row, which is what brings it back.
      let id = row?.id;
      if (!id) {
        const up = await serviceRpc(env, "email_account_upsert", { p_owner: who.id, p_address: email, p_scopes: [], p_capabilities: { archive: true, trash: true, read: true } });
        id = (up.data as { account_id?: string } | null)?.account_id;
      }
      if (id && row?.state !== "reauth") {
        const r = await serviceRpc(env, "email_account_state", { p_owner: who.id, p_account: id, p_state: "reauth", p_error: "Reconnect Gmail to continue." });
        if (!r.error) reauth.push(email);
      } else if (id) reauth.push(email);
      continue;
    }
    const r = await serviceRpc(env, "email_account_upsert", { p_owner: who.id, p_address: email, p_scopes: [], p_capabilities: { archive: true, trash: true, read: true } });
    if (!r.error) mirrored.push(email);
  }
  // Rows whose sign-in is gone: disconnected, cache and approved records kept.
  const disconnected: string[] = [];
  for (const row of existing ?? []) {
    if (!emails.has(row.address) && row.state !== "disconnected") {
      const r = await serviceRpc(env, "email_account_state", { p_owner: who.id, p_account: row.id, p_state: "disconnected", p_error: null });
      if (!r.error) disconnected.push(row.address);
    }
  }
  return json({ ok: true, mirrored, reauth, disconnected });
}
