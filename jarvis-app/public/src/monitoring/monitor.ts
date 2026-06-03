// Error-tracking seam. captureError always logs locally and forwards to a sink
// when one is registered. The sink stays empty until a DSN is configured at
// deploy, so the bundle carries no tracking SDK or network calls in the meantime.
type Sink = (error: unknown, context?: Record<string, unknown>) => void;

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

export function initMonitoring(): void {
  if (typeof window !== "undefined") {
    window.addEventListener("error", (e) => captureError(e.error ?? e.message, { kind: "window.error" }));
    window.addEventListener("unhandledrejection", (e) => captureError(e.reason, { kind: "unhandledrejection" }));
  }
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn) {
    // DEPLOY STEP: install @sentry/browser, then wire it here:
    //   import * as Sentry from "@sentry/browser";
    //   Sentry.init({ dsn });
    //   setErrorSink((e) => Sentry.captureException(e));
    // Kept as a slot so dev/sandbox builds need no SDK or network access.
  }
}
