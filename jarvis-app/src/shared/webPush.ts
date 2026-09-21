// WEB PUSH, the PWA half (2026-09-20, Dave's go through Clemenza).
//
// shared/notifications.ts is the NATIVE seam: Capacitor local notifications,
// and a clean no-op on the web. This file is the inverse: web only, a clean
// no-op on native, where WKWebView has no PushManager anyway. On one install
// exactly one of the two exists, so they can never double notify.
//
// The rules iOS imposes, all of which are states here rather than failures:
//   - Web push exists only in a Home Screen web app (display-mode standalone),
//     and only from iOS 16.4. In a Safari tab PushManager is undefined.
//   - The permission dialog opens only from a real tap. So the request is the
//     FIRST thing the tap handler does, synchronously, before any await.
//   - A denial is permanent; iOS never re-prompts. The copy says so.
//   - Every push must show a notification (userVisibleOnly), or iOS revokes
//     the subscription after a few silent ones. sw.js honors that.
//
// The key comes from the server at runtime through the proxy, never from
// this file. The retired app hardcoded one and went stale the day the pair
// changed.

import { Capacitor } from "@capacitor/core";
import { apiUrl } from "./apiBase";

export type Permission = "default" | "granted" | "denied" | "unsupported";

export interface WebPushEnv {
  native: boolean;
  hasServiceWorker: boolean;
  standalone: boolean;
  hasPushManager: boolean;
  permission: Permission;
  /** null until the server has been asked */
  hasKey: boolean | null;
  subscribed: boolean;
}

export type WebPushStatus = "native" | "no-sw" | "not-standalone" | "no-push" | "denied" | "no-key" | "off" | "on";

// One decision, in order, so every screen state has exactly one sentence.
export function webPushStatus(e: WebPushEnv): WebPushStatus {
  if (e.native) return "native";
  if (!e.hasServiceWorker) return "no-sw";
  if (!e.standalone) return "not-standalone";
  if (!e.hasPushManager) return "no-push";
  if (e.permission === "denied") return "denied";
  if (e.hasKey === false) return "no-key";
  return e.subscribed ? "on" : "off";
}

// Clemenza, condition 1: the master switch is all or nothing, because the
// server sends every alert to every device and ignores the four category
// switches. The copy says so where the switch is, not in a doc.
export const ALL_OR_NOTHING = "All alerts or none · The four switches above only shape the Notifications screen inside the app";

export function footFor(status: WebPushStatus): string {
  switch (status) {
    case "no-sw": return "This browser cannot receive alerts";
    case "not-standalone": return "Add JARVIS to your Home Screen to get alerts: Share, then Add to Home Screen, then open it from there";
    case "no-push": return "Alerts need iOS 16.4 or newer, opened from the Home Screen";
    case "denied": return "Notifications are off for JARVIS in iOS Settings · Turn them on under Settings, Notifications, JARVIS";
    case "no-key": return "The server has no push key yet, so alerts cannot be set up";
    case "off": return `Turn on Alerts on This Phone and iOS will ask to allow notifications · ${ALL_OR_NOTHING}`;
    case "on": return `Alerts arrive on this phone · ${ALL_OR_NOTHING}`;
    case "native": return "";
  }
}

// The lock: a state the switch cannot change by being tapped.
export function switchLocked(status: WebPushStatus): boolean {
  return status !== "off" && status !== "on";
}

// ---- the browser, read ------------------------------------------------------

export function isStandalone(w: Window = window): boolean {
  const nav = w.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof w.matchMedia === "function" && w.matchMedia("(display-mode: standalone)").matches);
}

const STORE_KEY = "jarvis.webpush.v1";
const RETRY_KEY = "jarvis.webpush.retry.v1";

interface Stored { on?: boolean; endpoint?: string; token?: string }

function readStore(): Stored {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Stored; } catch { return {}; }
}
function writeStore(s: Stored): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage is a convenience */ }
}

export function readEnv(w: Window = window): WebPushEnv {
  const n = (w as Window & { Notification?: { permission: string } }).Notification;
  return {
    native: Capacitor.isNativePlatform(),
    hasServiceWorker: "serviceWorker" in w.navigator,
    standalone: isStandalone(w),
    hasPushManager: "PushManager" in w && !!n,
    permission: n ? (n.permission as Permission) : "unsupported",
    hasKey: null,
    subscribed: readStore().on === true,
  };
}

// base64url, as web-push generates it, to the bytes PushManager wants.
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export interface PushDeps {
  getToken: () => string | undefined;
  fetchImpl?: typeof fetch;
}

async function fetchKey(deps: PushDeps): Promise<string | null> {
  const f = deps.fetchImpl ?? fetch;
  const r = await f(apiUrl("/api/push"));
  if (!r.ok) return null;
  const body = (await r.json()) as { publicKey?: string | null };
  return body.publicKey ?? null;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export type EnableResult = "on" | "denied" | "dismissed" | "no-key" | "failed" | "unauthenticated";

// THE TAP. Notification.requestPermission() is the first statement so the
// user activation the dialog needs is still live; everything else awaits.
export async function enableWebPush(deps: PushDeps): Promise<EnableResult> {
  const ask = Notification.permission === "granted" ? Promise.resolve("granted" as NotificationPermission) : Notification.requestPermission();
  const token = deps.getToken();
  if (!token) return "unauthenticated";
  const perm = await ask;
  if (perm === "denied") return "denied";
  if (perm !== "granted") return "dismissed";
  const key = await fetchKey(deps);
  if (!key) return "no-key";
  try {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
    const f = deps.fetchImpl ?? fetch;
    const r = await f(apiUrl("/api/push"), { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    if (!r.ok) return "failed";
    const body = (await r.json()) as { token?: string };
    writeStore({ on: true, endpoint: sub.endpoint, token: body.token });
    return "on";
  } catch {
    return "failed";
  }
}

export async function disableWebPush(deps: PushDeps): Promise<boolean> {
  const stored = readStore();
  let ok = true;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { ok = false; }
  const token = deps.getToken();
  if (stored.endpoint && stored.token && token) {
    try {
      const f = deps.fetchImpl ?? fetch;
      const r = await f(apiUrl("/api/push"), { method: "DELETE", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ endpoint: stored.endpoint, token: stored.token }) });
      ok = ok && r.ok;
    } catch { ok = false; }
  }
  writeStore({ on: false });
  return ok;
}

// Clemenza, condition 2: iOS can drop a subscription. On a standalone open,
// if the switch was on and permission is still granted but the browser holds
// no subscription, re-subscribe ONCE per app session. A failure sets the
// session flag and stops; the next cold open may try again. Never a prompt:
// permission is already granted, so subscribe() shows no dialog.
export async function resubscribeIfNeeded(deps: PushDeps, w: Window = window): Promise<"kept" | "resubscribed" | "skipped" | "failed"> {
  const env = readEnv(w);
  if (webPushStatus(env) !== "on" || env.permission !== "granted") return "skipped";
  let tried = false;
  try { tried = w.sessionStorage.getItem(RETRY_KEY) === "1"; } catch { /* no session storage: treat as tried, never loop */ tried = true; }
  if (tried) return "skipped";
  try {
    const reg = await registration();
    const existing = await reg.pushManager.getSubscription();
    if (existing) return "kept";
    try { w.sessionStorage.setItem(RETRY_KEY, "1"); } catch { /* see above */ }
    const r = await enableWebPush(deps);
    return r === "on" ? "resubscribed" : "failed";
  } catch {
    try { w.sessionStorage.setItem(RETRY_KEY, "1"); } catch { /* see above */ }
    return "failed";
  }
}

export async function sendTestAlert(deps: PushDeps): Promise<"sent" | "failed" | "unauthenticated"> {
  const token = deps.getToken();
  if (!token) return "unauthenticated";
  try {
    const f = deps.fetchImpl ?? fetch;
    const r = await f(apiUrl("/api/push?test=1"), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

// For the page: the current status, asking the server about the key only when
// everything else says it would matter (a key fetch in a Safari tab is a
// wasted round trip that changes nothing on screen).
export async function currentStatus(deps: PushDeps, w: Window = window): Promise<WebPushStatus> {
  const env = readEnv(w);
  const s = webPushStatus(env);
  if (s !== "off") return s;
  try {
    const key = await fetchKey(deps);
    return webPushStatus({ ...env, hasKey: key !== null });
  } catch {
    return webPushStatus({ ...env, hasKey: false });
  }
}
