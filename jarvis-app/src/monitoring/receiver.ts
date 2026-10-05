// CLIENT ERROR RECEIVER (2026-10-05). The logic behind api/client-error.ts,
// moved here for the reason src/push/proxy.ts and src/account/deleteAccount.ts
// were: api/ is in neither the typecheck nor the test run, and this is the
// half with rules worth testing. The api file is now the thin half that reads
// the environment and hands the request here.
//
// Why it changed. Since 2026-09-05 the receiver wrote one console.error line
// per report and nothing else. Vercel keeps function logs for a very short
// time, so a crash on a tester's phone was effectively lost within hours, and
// nobody had a place to look at crashes at all. Each report is now also
// inserted into the client_error table (migration 0053) through the Supabase
// REST API with the service key, and the Admin panel reads it back grouped by
// fingerprint (api/admin/errors.ts). The log line stays: it costs nothing and
// it is the record of last resort when the insert itself is what failed.
//
// What did not change, on purpose:
//   * NO auth. The launch gate and the boot path can fail before there is a
//     session, and those are exactly the crashes worth seeing. The cost is
//     bounded instead: a per-IP throttle and a body cap.
//   * The IP is used for the throttle only and is never stored or logged: the
//     record is about the failure, not the person.
//   * A JSON object, up to 16 KB. Anything else is refused as before.
//   * A failed or unconfigured insert NEVER changes the response. The client
//     is fire and forget, and a 5xx here would only invite a retry loop on a
//     phone that is already crashing. It is logged by name, never by value,
//     and the answer is still 204.

export interface ReceiverEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface StoreResponse { ok: boolean; status: number }
export type StoreFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<StoreResponse>;

export interface ReceiverDeps {
  env: ReceiverEnv;
  fetchImpl: StoreFetch;
  /** Milliseconds since the epoch. Injected so the throttle and retention are testable. */
  now: () => number;
  /** 0 up to but not including 1. Injected so the retention sweep is testable. */
  random: () => number;
}

export const MAX_BODY = 16_384;
export const PER_MIN = 60;
/** About one request in this many also sweeps old rows. */
export const SWEEP_ONE_IN = 200;
export const RETENTION_DAYS = 30;

// Column ceilings. The client already caps what it sends (monitor.ts, scrub.ts)
// but this endpoint has no auth, so it cannot assume the sender is our client.
export const LIMITS = { name: 200, message: 2000, stack: 4000, path: 500, userAgent: 500, build: 100 } as const;
const CONTEXT_CAP = 4000;

// The native build posts from capacitor://localhost, which is a different
// origin from the API, so the browser sends a preflight first. Answering it
// is what lets a report from the phone land at all.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function reply(status: number): Response {
  return new Response(null, { status, headers: CORS });
}

// The throttle lives in the isolate, so it is per instance and best effort,
// which is the posture it always had. `resetThrottle` is for tests.
const hits = new Map<string, { n: number; t: number }>();

export function resetThrottle(): void {
  hits.clear();
}

function allowed(ip: string, now: number): boolean {
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, t: now });
    return true;
  }
  h.n += 1;
  return h.n <= PER_MIN;
}

// ---- field handling -------------------------------------------------------

type Platform = "web" | "ios" | "other";

// Postgres text and jsonb refuse a NUL character and an unpaired surrogate,
// and either one would fail the whole insert and lose the report. A hostile or
// merely broken sender can put both in a string, so they are removed here
// rather than discovered in the database.
function clampText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\u0000/g, "").slice(0, max);
  const wf = (s as string & { toWellFormed?: () => string }).toWellFormed;
  return typeof wf === "function" ? wf.call(s) : s;
}

function cleanValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") return clampText(v, 500);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null) return v;
  if (depth >= 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => cleanValue(x, depth + 1) ?? null);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
      const c = cleanValue(val, depth + 1);
      if (c !== undefined) out[clampText(k, 100) ?? ""] = c;
    }
    return out;
  }
  return undefined;
}

// The context is only kept when it is an object, and only when it still fits
// after cleaning. Past the ceiling it is replaced by a marker and a prefix, the
// same way monitor.ts handles a context it cannot serialise, so the row says it
// was cut instead of holding half an object that parses as a whole one.
function clampContext(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const cleaned = cleanValue(v, 0) as Record<string, unknown>;
  const s = JSON.stringify(cleaned);
  if (s.length <= CONTEXT_CAP) return cleaned;
  return { truncated: clampText(s, 1000) ?? "" };
}

/** web, ios or other. A reported platform wins; otherwise the user agent decides. */
export function derivePlatform(reported: unknown, userAgent: string | undefined): Platform {
  if (typeof reported === "string" && reported) {
    const p = reported.toLowerCase();
    if (p === "ios") return "ios";
    if (p === "web") return "web";
    return "other";
  }
  const ua = userAgent ?? "";
  if (!ua) return "other";
  if (/capacitor/i.test(ua)) return "ios";
  // A WKWebView on an iPhone or iPad has no "Safari/" token; Safari itself does.
  if (/\b(iPhone|iPad|iPod)\b/.test(ua) && !/\bSafari\//.test(ua)) return "ios";
  return "web";
}

// The first real frame, not the "Error: message" header: Chrome and V8 write
// "    at fn (url:line:col)", Safari and Firefox write "fn@url:line:col".
export function firstFrame(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n");
  const v8 = lines.find((l) => /^\s+at\s/.test(l));
  if (v8) return v8.trim();
  const jsc = lines.find((l) => /^[^\s]*@\S+:\d+/.test(l));
  return jsc ? jsc.trim() : "";
}

const enc = new TextEncoder();

/** sha-256, hex, of name + message + first stack frame: one bug, one group. */
export async function fingerprintOf(name: string, message: string, stack: string | undefined): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(name + "\n" + message + "\n" + firstFrame(stack)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ClientErrorRow {
  build?: string;
  platform: Platform;
  name: string;
  message: string;
  stack?: string;
  path?: string;
  user_agent?: string;
  context?: Record<string, unknown>;
  fingerprint: string;
}

export async function toRow(report: Record<string, unknown>): Promise<ClientErrorRow | null> {
  const name = clampText(report.name, LIMITS.name) || "Error";
  const message = clampText(report.message, LIMITS.message) ?? "";
  const stack = clampText(report.stack, LIMITS.stack) || undefined;
  // Nothing to say about a failure: not worth a row. It is still logged.
  if (!message && !stack && typeof report.name !== "string") return null;
  const userAgent = clampText(report.userAgent, LIMITS.userAgent) || undefined;
  const row: ClientErrorRow = {
    platform: derivePlatform(report.platform, userAgent),
    name,
    message,
    fingerprint: await fingerprintOf(name, message, stack),
  };
  const build = clampText(report.build, LIMITS.build);
  if (build) row.build = build;
  if (stack) row.stack = stack;
  const path = clampText(report.path, LIMITS.path);
  if (path) row.path = path;
  if (userAgent) row.user_agent = userAgent;
  const context = clampContext(report.context);
  if (context) row.context = context;
  return row;
}

// ---- storage --------------------------------------------------------------

function restBase(env: ReceiverEnv): { base: string; headers: Record<string, string> } | { missing: string[] } {
  const url = (env.SUPABASE_URL ?? "").trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (missing.length) return { missing };
  return {
    base: url.replace(/\/+$/, "") + "/rest/v1/client_error",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
  };
}

// Every outcome of the store is logged and none of it is thrown. The log names
// what is wrong and never a value (the key is the one value that matters).
async function store(row: ClientErrorRow | null, deps: ReceiverDeps): Promise<void> {
  if (!row) return;
  const target = restBase(deps.env);
  if ("missing" in target) {
    console.error(`[jarvis-client-error] not stored: missing ${target.missing.join(", ")}`);
    return;
  }
  try {
    const r = await deps.fetchImpl(target.base, { method: "POST", headers: target.headers, body: JSON.stringify(row) });
    if (!r.ok) console.error(`[jarvis-client-error] not stored: the database answered ${r.status}`);
  } catch {
    console.error("[jarvis-client-error] not stored: the database could not be reached");
    return;
  }
  // Retention is opportunistic: about one request in 200 clears what is past
  // its window, so there is no cron and no extension to configure. It runs
  // after the insert and can fail without anyone noticing, which is fine: the
  // next sweep gets it.
  if (deps.random() < 1 / SWEEP_ONE_IN) {
    const cutoff = new Date(deps.now() - RETENTION_DAYS * 86_400_000).toISOString();
    try {
      const r = await deps.fetchImpl(`${target.base}?created_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE", headers: target.headers });
      if (!r.ok) console.error(`[jarvis-client-error] sweep failed: the database answered ${r.status}`);
    } catch {
      console.error("[jarvis-client-error] sweep failed: the database could not be reached");
    }
  }
}

// ---- the handler ----------------------------------------------------------

export async function handleClientError(req: Request, deps: ReceiverDeps): Promise<Response> {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowed(ip, deps.now())) return reply(429);

  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400);
  }
  if (text.length === 0 || text.length > MAX_BODY) return reply(413);

  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return reply(400);
    report = parsed as Record<string, unknown>;
  } catch {
    return reply(400);
  }

  // One line per report, JSON, fixed prefix, as before. The host's log viewer
  // is the reader of last resort: prefix, build, name, then the report as sent.
  console.error(
    "[jarvis-client-error]",
    String(report.build ?? "?"),
    String(report.name ?? "Error"),
    JSON.stringify(report),
  );

  // Nothing below may change the answer. toRow and store are both inside the
  // guard: a hashing failure is as unable to reject a report as a database one.
  try {
    await store(await toRow(report), deps);
  } catch {
    console.error("[jarvis-client-error] not stored: unexpected failure");
  }
  return reply(204);
}
