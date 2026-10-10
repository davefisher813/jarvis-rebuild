// WEB PUSH PROXY (2026-09-20, Dave's go through Clemenza).
//
// The PWA cannot talk to the JARVIS backend on Railway directly: every push
// route there wants the shared secret in an x-jarvis-secret header, and a
// secret that reaches a phone is not a secret. So api/push.ts, a Vercel edge
// function, is the only caller. It proves who is asking (the caller's own
// Supabase JWT, same gate as api/ai-usage.ts), adds the secret server side,
// and forwards. The logic lives HERE, in src, for the same reason
// deleteAccount.ts does: this is the half with rules worth testing, and api/
// is in neither the typecheck nor the test run.
//
//   GET    /api/push            the VAPID public key, fetched at runtime,
//                               never hardcoded (the retired app hardcoded
//                               one and went stale the day the pair changed)
//   POST   /api/push            {subscription}: register; answers {token}
//   DELETE /api/push            {endpoint, token}: remove, only with the
//                               token this proxy issued for THAT endpoint to
//                               THAT user (Clemenza, condition 3)
//   POST   /api/push?test=1     one test alert to every device
//   POST   /api/push?inbox=pull the backend inbox leg of the VYZN feed (Phase 0,
//                               PHASE0-DESIGN.md D6 item 7): 404 unless the
//                               vyzn_sync_v1 flag is on; GETs the agent inbox
//                               with the secret, maps it to records, hands them
//                               to records_import AS THE PERSON (their own
//                               bearer, the anon apikey), and deletes a backend
//                               item ONLY once Dave has taken it (already_saved,
//                               or a replay whose status is accepted or
//                               dismissed). A proposed record stays in the
//                               backend inbox until the tap: Dave's input always
//                               wins in both systems. Never logs a task's text.
//
// Missing configuration is a sentence, not a mystery: with either server
// variable unset the proxy answers 503 naming WHICH one, and never a value.

import { parseFlags } from "../substrate/flagList";
import { backendInboxToRecords, batches, type IngestAnswer, type RecordOutcome, type VyznRecord } from "../substrate/records/envelope";

export interface PushEnv {
  JARVIS_SECRET?: string;
  JARVIS_BACKEND_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** The build's flag string (VITE_JARVIS_FLAGS), parsed here with the pure parser. */
  FLAGS?: string;
}

export interface FetchResponse { ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export const REQUIRED = ["JARVIS_SECRET", "JARVIS_BACKEND_URL"] as const;

export function missingEnv(env: PushEnv): string[] {
  return REQUIRED.filter((k) => !env[k] || !String(env[k]).trim());
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

// Ownership without a table: the token is an HMAC over the user id and the
// endpoint, keyed from the server secret with a fixed label so it can never
// be confused with the secret itself or with any other use of it. The client
// stores it beside the endpoint and presents both to unsubscribe; the proxy
// recomputes and compares, so a signed in user cannot remove a device they
// did not register through their own session.
export async function ownershipToken(secret: string, userId: string, endpoint: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode("jarvis-push-ownership:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(userId + "\n" + endpoint)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function json(obj: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
}

async function whoIs(req: Request, env: PushEnv, fetchImpl: FetchLike): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const who = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } });
  if (!who.ok) return null;
  const me = (await who.json()) as { id?: string };
  return me.id || null;
}

export async function handlePush(req: Request, deps: { env: PushEnv; fetchImpl: FetchLike }): Promise<Response> {
  const { env, fetchImpl } = deps;
  const missing = missingEnv(env);
  if (missing.length) {
    // Loud and specific. The name is the whole message; the value is never
    // part of any response or log line.
    console.error(`[push] not configured: missing ${missing.join(", ")}`);
    return json({ error: "Push is not configured on the server", missing }, 503);
  }
  const base = String(env.JARVIS_BACKEND_URL).replace(/\/+$/, "");
  const secretHeaders = { "content-type": "application/json", "x-jarvis-secret": String(env.JARVIS_SECRET) };

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // The key is public by design (it is handed to the browser to subscribe),
  // so it needs no caller identity. It still goes through here so the client
  // never learns the backend origin.
  if (method === "GET") {
    const r = await fetchImpl(`${base}/api/push/vapid-key`);
    if (!r.ok) return json({ error: "The server did not answer for the push key" }, 502);
    const body = (await r.json()) as { publicKey?: string | null };
    return json({ publicKey: body.publicKey ?? null });
  }

  // The pull does not exist without its flag: 404 before any identity is looked at.
  const pull = method === "POST" && url.searchParams.get("inbox") === "pull";
  if (pull && !parseFlags(env.FLAGS).has("vyzn_sync_v1")) return json({ error: "Not found" }, 404);

  const userId = await whoIs(req, env, fetchImpl);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  if (pull) return pullInbox(req, env, fetchImpl, base, secretHeaders);

  if (method === "POST" && url.searchParams.get("test") === "1") {
    const r = await fetchImpl(`${base}/api/push/test`, { method: "POST", headers: secretHeaders, body: JSON.stringify({ message: "Test alert from JARVIS" }) });
    return json({ ok: r.ok }, r.ok ? 200 : 502);
  }

  if (method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { subscription?: { endpoint?: string } };
    const endpoint = body.subscription?.endpoint;
    if (!endpoint) return json({ error: "A subscription with an endpoint is required" }, 400);
    const r = await fetchImpl(`${base}/api/push/subscribe`, { method: "POST", headers: secretHeaders, body: JSON.stringify({ subscription: body.subscription }) });
    if (!r.ok) return json({ error: "The server refused the subscription" }, 502);
    return json({ ok: true, token: await ownershipToken(String(env.JARVIS_SECRET), userId, endpoint) });
  }

  if (method === "DELETE") {
    const body = (await req.json().catch(() => ({}))) as { endpoint?: string; token?: string };
    if (!body.endpoint || !body.token) return json({ error: "endpoint and token are required" }, 400);
    const expected = await ownershipToken(String(env.JARVIS_SECRET), userId, body.endpoint);
    if (!constantTimeEqual(expected, body.token)) return json({ error: "That device was not registered from this account" }, 403);
    const r = await fetchImpl(`${base}/api/push/subscribe`, { method: "DELETE", headers: secretHeaders, body: JSON.stringify({ endpoint: body.endpoint }) });
    return json({ ok: r.ok }, r.ok ? 200 : 502);
  }

  return json({ error: "Method not allowed" }, 405);
}

/** The counts a pull answers. `pulled` is what the backend held and the mapping accepted; `refused` is what it did
 *  not (a shape the mapping or the gateway schema refuses, or a batch the server refused whole); `remaining` is
 *  what the backend still holds beyond INBOX_CAP, left for the next pull. */
export interface PullAnswer { pulled: number; proposed: number; replayed: number; already: number; superseded: number; deleted: number; refused: number; remaining: number }

/** The most backend items one pull handles: 10 rpc POSTs plus a DELETE per taken item is one edge invocation's worth. */
export const INBOX_CAP = 500;

/** Taken means Dave accepted or dismissed it (his decision 2, the default): only then is the backend's copy consumed. */
export function takenByDave(r: RecordOutcome): boolean {
  return r.outcome === "already_saved" || (r.outcome === "replay" && (r.status === "accepted" || r.status === "dismissed"));
}

/** An upstream body as JSON, or null when it is not JSON at all (a proxy's HTML error page, an empty 2xx). */
async function readJson(res: FetchResponse): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function pullInbox(req: Request, env: PushEnv, fetchImpl: FetchLike, base: string, secretHeaders: Record<string, string>): Promise<Response> {
  const jwt = (req.headers.get("authorization") || "").slice("Bearer ".length);
  const got = await fetchImpl(`${base}/api/memory/tasks`, { headers: { "x-jarvis-secret": secretHeaders["x-jarvis-secret"]! } });
  if (!got.ok) return json({ error: "The backend inbox did not answer" }, 502);
  // A body that is not an object holding an inbox list is the same 502 as no answer: nothing is written or deleted.
  const listed = await readJson(got);
  if (!isObject(listed) || !Array.isArray(listed.inbox)) return json({ error: "The backend inbox did not answer" }, 502);
  const handled = listed.inbox.slice(0, INBOX_CAP);
  const { records, refused } = backendInboxToRecords(handled);
  const answer: PullAnswer = { pulled: records.length, proposed: 0, replayed: 0, already: 0, superseded: 0, deleted: 0, refused: refused.length, remaining: listed.inbox.length - handled.length };
  if (records.length === 0) return json(answer);

  // A batch the server refused whole wrote nothing, so nothing is consumed on the backend side for it; it is
  // counted under refused and the NEXT batch still runs, so one bad record never stalls the rest of the inbox on
  // every pull. The choice for the status: 422 only when every batch was refused (the pull achieved nothing and
  // the first refusal says why); otherwise 200 with the counts, because the records the server took are taken.
  let refusedBatches = 0;
  let firstRefusal: { error: string; detail?: string } | null = null;
  const sent = batches<VyznRecord>(records);
  for (const batch of sent) {
    const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/records_import`, {
      method: "POST",
      headers: { apikey: String(env.SUPABASE_ANON_KEY), Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ p_source_app: "backend-inbox", p_records: batch }),
    });
    if (!r.ok) return json({ ...answer, error: "JARVIS did not take the records" }, 502);
    // A 2xx whose body is not an answer (null, {}, not JSON) stops the pull with the counts so far: nothing in this
    // batch is deleted, because nothing says Dave took it.
    const out = await readJson(r);
    if (!isObject(out) || (!("error" in out) && !Array.isArray(out.results))) return json({ ...answer, error: "JARVIS did not answer" }, 502);
    if ("error" in out) {
      const bad = out as { error: string; detail?: string };
      refusedBatches += 1;
      answer.refused += batch.length;
      firstRefusal ??= { error: bad.error, ...(bad.detail ? { detail: bad.detail } : {}) };
      continue;
    }
    for (const res of (out as unknown as IngestAnswer).results) {
      if (res.outcome === "proposed") { answer.proposed += 1; answer.superseded += res.superseded ?? 0; }
      else if (res.outcome === "newer_revision_proposed") answer.proposed += 1;
      else if (res.outcome === "replay") answer.replayed += 1;
      else if (res.outcome === "already_saved") answer.already += 1;
      if (!takenByDave(res)) continue;
      const gone = await fetchImpl(`${base}/api/memory/tasks/${encodeURIComponent(res.source_record_id)}`, { method: "DELETE", headers: secretHeaders });
      if (gone.ok) answer.deleted += 1;
    }
  }
  if (firstRefusal && refusedBatches === sent.length) return json({ ...answer, ...firstRefusal }, 422);
  return json(answer);
}
