import type { Store } from "@core";

// S3-Q14 (2026-09-04): "There is no online or offline listener for user data
// anywhere." The one that existed (events/index.ts) flushes the analytics
// sink only. The core Store has always known how to hold a write offline and
// replay it on reconnect; nothing in the app ever told it the signal
// actually dropped, so goOffline()/reconnect() sat there as pass-throughs
// only test harnesses ever called.
//
// The browser's own online/offline events are the one connectivity signal
// every platform this ships on already fires, including the Capacitor
// WebView on iOS -- no polling, no extra permission.
export function wireOfflineSync(store: Store): () => void {
  if (typeof window === "undefined") return () => {};
  // A launch that starts offline (airplane mode before the app ever opens)
  // gets no "offline" event to react to -- there was nothing to transition
  // from. Check the state directly once, up front.
  if (typeof navigator !== "undefined" && navigator.onLine === false) store.goOffline();
  const onOffline = () => store.goOffline();
  // A failed reconnect (the network blipped back for a second and dropped
  // again) is not lost: reconnect() leaves whatever did not land still
  // queued (S3-Q14 core fix), so the next "online" event simply retries it.
  const onOnline = () => { store.reconnect().catch(() => { /* retried on the next online event */ }); };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}
