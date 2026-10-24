// THE DOCUMENT CLOCK (Doc AI, build order 2026-10-23; migration 0073).
//
// A document Dave uploads is a queued job. This is the clock that reads it: Postgres (pg_cron, every ten seconds, and only while a job
// is due) calls this route; it sweeps what a dead tick left behind, then claims one job at a time under a lease and carries it out
// with the pure core (src/docai/worker.ts). The page does not have to stay open.
//
// It lives behind POST /api/ai with the header `x-jarvis-worker: docs` and NOT as a route of its own: the host plan caps how many API
// files a deployment may hold (src/laws/apiFunctionBudget.test.ts). An underscore file is a module, not a function.
//
// ONE AI DOOR. This file never calls a model. Reading a PDF's text layer is not an AI call (law 3) and happens here. Extraction asks
// /api/ai itself, over HTTP, with the header `x-jarvis-worker: docs-call`, a live claim (job + token) and the cron secret. /api/ai
// then runs its own gate (admin switch, AI Control level with the docExtract pin), caps, dollar budget and token log exactly as for
// the browser; the only difference is who vouches for the user (docCallIdentity below). A caller without a live claim cannot spend.
//
// POST only, and only with the bearer secret held in Postgres' vault (doc_cron_ok). It answers counts, never a document, never text.

import { runDocOnce, type ClaimedDoc, type DocRunResult, type DocWorkerDeps } from "../src/docai/worker";
import type { AICall, AIResult } from "../src/docai/extract";
import type { DocText } from "../src/docai/types";

/** The header that routes a request: `docs` is the clock, `docs-call` is the clock asking the AI door. */
export const WORKER_HEADER = "x-jarvis-worker";
export const DOC_WORKER = "docs";
export const DOC_CALL = "docs-call";

/** Jobs carried out per call. A call is short; the next tick takes the next ones. */
export const MAX_PER_CALL = 3;
/** Stop starting new jobs after this (the edge function's own budget). */
export const BUDGET_MS = 20_000;
/** The bucket's own cap (migration 0020) is 10 MB; this is a guard, not a policy. */
const MAX_BYTES = 12 * 1024 * 1024;
const BUCKET = "user-files";

interface Env { supaUrl: string; service: string }
type Json = Record<string, unknown>;

function readEnv(): Env | null {
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return supaUrl && service ? { supaUrl, service } : null;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const headers = (env: Env): Record<string, string> => ({ apikey: env.service, Authorization: `Bearer ${env.service}`, "content-type": "application/json" });

async function rpc(env: Env, fn: string, args: Json = {}): Promise<{ data: unknown; error: unknown }> {
  try {
    const res = await fetch(`${env.supaUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(env), body: JSON.stringify(args) });
    if (!res.ok) return { data: null, error: { status: res.status } };
    const text = await res.text();
    return { data: text ? JSON.parse(text) : null, error: null };
  } catch {
    return { data: null, error: { network: true } };
  }
}

async function select<T>(env: Env, path: string): Promise<T[] | null> {
  try {
    const res = await fetch(`${env.supaUrl}/rest/v1/${path}`, { headers: headers(env) });
    return res.ok ? ((await res.json()) as T[]) : null;
  } catch {
    return null;
  }
}

const bearerOf = (req: Request): string => (req.headers.get("authorization") || "").replace(/^Bearer /, "");

/** Is this the cron's secret? Asked of the database; the secret lives in the vault and nowhere else. */
async function secretOk(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  const ok = await rpc(env, "doc_cron_ok", { p_token: token });
  return !ok.error && ok.data === true;
}

/**
 * Who vouches for an internal docs call. The secret must be right AND the job must be claimed right now under the token its claim returned
 * (doc_job_owner), so the secret alone never spends as anyone. Returns the owner and their app_metadata (the admin switch is read from it),
 * or null.
 */
export async function docCallIdentity(req: Request): Promise<{ id: string; app_metadata: unknown } | null> {
  const env = readEnv();
  if (!env) return null;
  if (!(await secretOk(env, bearerOf(req)))) return null;
  const job = req.headers.get("x-jarvis-job") || "";
  const claim = req.headers.get("x-jarvis-claim") || "";
  if (!/^[0-9a-f-]{36}$/i.test(job) || !/^[0-9a-f-]{36}$/i.test(claim)) return null;
  const owner = await rpc(env, "doc_job_owner", { p_job: job, p_token: claim });
  if (owner.error || typeof owner.data !== "string") return null;
  try {
    const res = await fetch(`${env.supaUrl}/auth/v1/admin/users/${owner.data}`, { headers: headers(env) });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; app_metadata?: unknown };
    return u.id === owner.data ? { id: u.id, app_metadata: u.app_metadata } : null;
  } catch {
    return null;
  }
}

/** The AI door's answer, mapped to the extraction code the core understands. Nothing here guesses: an answer it cannot place is UNKNOWN. */
export function mapAiAnswer(status: number, body: { text?: unknown; stop_reason?: unknown; code?: unknown; detail?: unknown } | null): AIResult {
  if (status === 200) {
    if (!body || typeof body.text !== "string") return { ok: false, code: "SCHEMA" };
    try {
      return { ok: true, json: JSON.parse(body.text), truncated: body.stop_reason === "max_tokens" };
    } catch {
      // A reply cut off mid-JSON by the output cap, or not JSON at all: the slice is not trusted.
      return { ok: false, code: "SCHEMA" };
    }
  }
  // The gate said no (AI Off, On Request with no ask, the admin switch): the document is read and reported as not reviewed.
  if (status === 403) return { ok: false, code: "OFF" };
  if (status === 402) return { ok: false, code: body?.code === "AI_BUDGET_OFF" ? "OFF" : "BUSY" };
  // A repeated request id: a call under this id may already have been made.
  if (status === 409) return { ok: false, code: "UNKNOWN" };
  if (status === 429 || status === 503) return { ok: false, code: "BUSY" };
  if (status === 502) {
    const detail = typeof body?.detail === "string" ? body.detail : "";
    if (/credit balance|billing|purchase credits/i.test(detail)) return { ok: false, code: "CREDIT" };
    // The provider answered with a refusal of its own: nothing ran. No detail at all means the request may have left.
    if (!detail) return { ok: false, code: "UNKNOWN" };
    if (/overloaded_error|rate_limit_error/.test(detail)) return { ok: false, code: "BUSY" };
    return { ok: false, code: "UPSTREAM" };
  }
  return { ok: false, code: "UPSTREAM" };
}

/** The AI call for one job: through /api/ai, never around it. */
function makeCall(origin: string, secret: string): DocWorkerDeps["makeCall"] {
  return (job: ClaimedDoc): AICall => {
    let seq = 0;
    return async (req): Promise<AIResult> => {
      const res = await fetch(`${origin}/api/ai`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          [WORKER_HEADER]: DOC_CALL,
          "x-jarvis-job": job.job_id,
          "x-jarvis-claim": job.claim_token,
          // A unique id per call: a repeat of the same id is a replay the budget refuses, never a second spend.
          "x-request-id": `doc-${job.job_id}-${job.attempt}-${seq++}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: req.user }],
          system: req.system,
          schema: req.schema,
          kind: req.purpose === "classify" ? "doc-classify" : "doc-extract",
          pin: "docExtract",
          // A document nobody asked to review is background work; a tap on Review This is not.
          background: !job.requested,
        }),
      });
      const body = (await res.json().catch(() => null)) as Parameters<typeof mapAiAnswer>[1];
      return mapAiAnswer(res.status, body);
    };
  };
}

function depsFor(env: Env, req: Request, secret: string): DocWorkerDeps {
  const region = (req.headers.get("x-vercel-id") || "edge").split("::")[0];
  const origin = new URL(req.url).origin;
  return {
    rpc: (fn, args) => rpc(env, fn, args ?? {}),
    worker: `cron:${region}`,
    loadFile: async (owner, id) => {
      const rows = await select<{ data?: { name?: string; mime?: string; path?: string; bytes?: number } }>(
        env, `item?id=eq.${id}&owner_id=eq.${owner}&entity_type=eq.user_file&select=data&limit=1`);
      const d = rows?.[0]?.data;
      return d ? { name: String(d.name ?? ""), mime: String(d.mime ?? ""), path: String(d.path ?? ""), bytes: Number(d.bytes ?? 0) } : null;
    },
    loadText: async (owner, id) => {
      const rows = await select<{ text: string; pages: DocText["pages"]; words: number; lane: DocText["lane"]; failed_pages: number[] }>(
        env, `doc_text?owner_id=eq.${owner}&file_id=eq.${id}&select=text,pages,words,lane,failed_pages&limit=1`);
      const r = rows?.[0];
      return r ? { text: r.text, pages: r.pages, words: r.words, lane: r.lane, failedPages: r.failed_pages ?? [] } : null;
    },
    downloadBytes: async (path) => {
      if (!path) return null;
      try {
        const res = await fetch(`${env.supaUrl}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: env.service, Authorization: `Bearer ${env.service}` } });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return buf.byteLength > MAX_BYTES ? null : new Uint8Array(buf);
      } catch {
        return null;
      }
    },
    makeCall: makeCall(origin, secret),
  };
}

export async function runDocWorker(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response(JSON.stringify({ code: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
  const env = readEnv();
  if (!env) return json({ code: "UNAVAILABLE" }, 503);
  const given = bearerOf(req);
  if (!(await secretOk(env, given))) return json({ code: "UNAUTHORIZED" }, 401);

  const started = Date.now();
  // Dead claims past their lease become unknowns first (doc_sweep, migration 0073).
  await rpc(env, "doc_sweep");

  const deps = depsFor(env, req, given);
  const counts = { handled: 0, done: 0, wait: 0, retry: 0, failed: 0, unknown: 0, lease_lost: 0 };
  for (let i = 0; i < MAX_PER_CALL; i++) {
    if (Date.now() - started > BUDGET_MS) break;
    let r: DocRunResult;
    try {
      r = await runDocOnce(deps);
    } catch {
      break;
    }
    if (!r.handled) break;
    counts.handled++;
    counts[r.outcome]++;
  }
  return json(counts);
}
