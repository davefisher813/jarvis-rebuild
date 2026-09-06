import type { ErrorReport } from "./monitor";

// UP-LAUNCH-07 (2026-09-05), fork option A: Sentry.
//
// Reached over Sentry's documented envelope endpoint rather than through
// @sentry/capacitor and @sentry/react, and that is a deliberate trade worth
// reading before anyone "fixes" it:
//
//   What this buys. Nothing is added to the bundle, nothing is added to
//   package.json, and no third-party code runs on a minor's phone. The SDK is
//   about 40 KB gzipped of instrumentation the app does not want: it patches
//   fetch, XHR, history and console to build breadcrumbs, and breadcrumbs are
//   exactly the thing that would carry a note's text or a mail subject off
//   the device. Sending a report we composed ourselves means the payload is
//   the payload, and scrub.ts is the only thing that decides what is in it.
//
//   What this costs. No native iOS crash capture. A crash in Swift, or one
//   that kills the webview outright, never reaches JavaScript and so never
//   reaches this. That capture needs the native SDK and a pod, which needs
//   the native build session anyway. When that session happens, the SDK can
//   be initialized alongside this and the JavaScript half of it turned off.
//
// The wire format is the envelope: an envelope header line, an item header
// line, and the item payload, each a JSON object on its own line
// (https://develop.sentry.dev/sdk/envelopes/). It has been stable for years
// and is what every SDK posts.

export interface Dsn {
  /** Full URL to POST envelopes to. */
  endpoint: string;
  /** The public key, which goes in the auth header. */
  publicKey: string;
}

/**
 * https://<publicKey>@<host>/<projectId> is the whole grammar. Anything else
 * returns null and the caller sets no sink at all: a half-parsed DSN that
 * posts into the void is worse than no reporting, because it looks configured.
 */
export function parseDsn(raw: string | undefined): Dsn | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

// Identifies this client in Sentry's UI. Not a version claim about an SDK we
// do not use: it says which code composed the envelope.
export const CLIENT = "jarvis-monitor/1.0";

export function authHeader(dsn: Dsn): string {
  return `Sentry sentry_version=7, sentry_client=${CLIENT}, sentry_key=${dsn.publicKey}`;
}

// Sentry wants a 32 character hex id per event. Math.random is fine here:
// this is a de-duplication key, never a secret.
function eventId(rand: () => number = Math.random): string {
  let s = "";
  while (s.length < 32) s += Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0");
  return s.slice(0, 32);
}

/**
 * One report as a Sentry event. Stack frames are left as the raw string in
 * `extra` rather than parsed into Sentry's frame objects: parsing a stack
 * correctly across engines is a library's job, and Sentry renders the raw
 * value fine. What matters is that the stack arrives at all.
 */
export function sentryEvent(r: ErrorReport, id = eventId()): Record<string, unknown> {
  return {
    event_id: id,
    timestamp: r.at,
    platform: "javascript",
    level: "error",
    logger: "jarvis",
    release: r.build,
    // No user object, ever. The report carries no account id, and telling
    // Sentry who it belongs to is the one line that would turn an unlinked
    // crash record into a linked one (see the privacy manifest).
    exception: {
      values: [{
        type: r.name,
        value: r.message,
        stacktrace: r.stack ? { frames: [] } : undefined,
      }],
    },
    request: r.path ? { url: r.path } : undefined,
    contexts: r.userAgent ? { browser: { name: r.userAgent } } : undefined,
    extra: { ...(r.context ?? {}), ...(r.stack ? { stack: r.stack } : {}) },
  };
}

export function envelope(r: ErrorReport, id = eventId()): string {
  const event = sentryEvent(r, id);
  const header = JSON.stringify({ event_id: id, sent_at: r.at });
  const itemHeader = JSON.stringify({ type: "event" });
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`;
}
