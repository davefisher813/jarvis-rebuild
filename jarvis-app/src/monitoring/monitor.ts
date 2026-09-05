// Error-tracking seam. captureError always logs locally and forwards to a sink
// when one is registered. The ErrorBoundary, the window error and
// unhandledrejection handlers, and the launch gate all report through here,
// so a sink set once at boot sees every crash the app knows about.
//
// PLUMB-F-11 (2026-09-05): the seam existed for months with no sink ever set;
// the Sentry slot below it was comments. A render crash on the phone printed
// to a console nobody reads and left no record anywhere. The sink is now a
// small fetch POST, switched on by VITE_ERROR_SINK: "1" sends to the app's
// own receiver (api/client-error.ts, reached through API_BASE like every
// other serverless call), a full URL sends to anything that accepts JSON.
// No SDK: adding one would grow the bundle for a job that is one request. A
// Sentry-style SDK can still be dropped in later through setErrorSink
// without touching a caller.
import { apiUrl } from "../shared/apiBase";

type Sink = (error: unknown, context?: Record<string, unknown>) => void;

export const OWN_RECEIVER_PATH = "/api/client-error";

let sink: Sink | null = null;

export function setErrorSink(fn: Sink | null): void {
  sink = fn;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[jarvis]", error, context ?? "");
  try {
    sink?.(error, context);
  } catch {
    /* a broken reporter must never crash the app */
  }
}

// What one report carries. Deliberately no query string and no URL hash:
// the OAuth callback puts a code in the query and Supabase's implicit flow
// puts tokens in the hash, and an error log is the wrong place for either.
export interface ErrorReport {
  name: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  at: string;
  build: string;
  path?: string;
  userAgent?: string;
}

const STACK_CAP = 4000;
const CONTEXT_CAP = 4000;

function buildId(): string {
  return typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
}

function safeJson(value: unknown, cap: number): string | undefined {
  try {
    const seen = new WeakSet<object>();
    const s = JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === "bigint") return String(v);
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[cycle]";
        seen.add(v);
      }
      return v;
    });
    return s === undefined ? undefined : s.length > cap ? s.slice(0, cap) : s;
  } catch {
    return undefined;
  }
}

export function toErrorReport(error: unknown, context?: Record<string, unknown>): ErrorReport {
  let name = "Error";
  let message: string;
  let stack: string | undefined;
  if (error instanceof Error) {
    name = error.name || "Error";
    message = error.message;
    stack = error.stack;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = safeJson(error, 1000) ?? String(error);
  }
  const report: ErrorReport = {
    name,
    message: message.length > 2000 ? message.slice(0, 2000) : message,
    at: new Date().toISOString(),
    build: buildId(),
  };
  if (stack) report.stack = stack.length > STACK_CAP ? stack.slice(0, STACK_CAP) : stack;
  if (context) {
    // Round-trip through the safe serializer so a cyclic or huge context
    // (a React componentStack, a caught response object) cannot blow up the
    // request body or the JSON encoder.
    const s = safeJson(context, CONTEXT_CAP);
    if (s) {
      try { report.context = JSON.parse(s) as Record<string, unknown>; }
      catch { report.context = { truncated: s }; }
    }
  }
  if (typeof location !== "undefined") report.path = location.pathname;
  if (typeof navigator !== "undefined") report.userAgent = navigator.userAgent;
  return report;
}

export interface FetchSinkOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  // Ceiling on reports per minute. A component that throws on every render
  // would otherwise turn one bug into hundreds of requests from one phone.
  maxPerMinute?: number;
  // The same error (name, message, first stack frame) is sent once per this
  // window. React reports a boundary crash twice in development (its own
  // rethrow to window.error, then componentDidCatch); this folds them.
  repeatWindowMs?: number;
}

// A sink that POSTs each report as JSON to `url`. It never throws and never
// awaits: a failed report is dropped, because the reporter must not become a
// second failure on top of the first. keepalive lets a report sent during
// pagehide finish after the page is gone.
export function createFetchSink(url: string, opts: FetchSinkOptions = {}): Sink {
  const fetchFn = opts.fetchFn ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const now = opts.now ?? (() => Date.now());
  const maxPerMinute = opts.maxPerMinute ?? 20;
  const repeatWindowMs = opts.repeatWindowMs ?? 60_000;
  const sentAt: number[] = [];
  const lastByKey = new Map<string, number>();

  return (error, context) => {
    if (!fetchFn) return;
    const t = now();
    const report = toErrorReport(error, context);
    const key = report.name + "|" + report.message + "|" + (report.stack?.split("\n")[1] ?? "");
    const last = lastByKey.get(key);
    if (last !== undefined && t - last < repeatWindowMs) return;
    while (sentAt.length > 0 && t - sentAt[0]! >= 60_000) sentAt.shift();
    if (sentAt.length >= maxPerMinute) return;
    sentAt.push(t);
    lastByKey.set(key, t);
    if (lastByKey.size > 200) lastByKey.clear();
    try {
      void fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        keepalive: true,
      }).catch(() => { /* dropped on purpose */ });
    } catch {
      /* a synchronous fetch failure (bad URL) is dropped the same way */
    }
  };
}

export function initMonitoring(): void {
  if (typeof window !== "undefined") {
    window.addEventListener("error", (e) => captureError(e.error ?? e.message, { kind: "window.error" }));
    window.addEventListener("unhandledrejection", (e) => captureError(e.reason, { kind: "unhandledrejection" }));
  }
  const url = resolveSinkUrl(import.meta.env.VITE_ERROR_SINK as string | undefined);
  if (url) setErrorSink(createFetchSink(url));
}

// "1" (or "true") means the app's own receiver; anything else that looks like
// a URL is taken as is; empty or unset means no sink, which is the dev and
// sandbox state.
export function resolveSinkUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v === "1" || v.toLowerCase() === "true") return apiUrl(OWN_RECEIVER_PATH);
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v;
  return null;
}
