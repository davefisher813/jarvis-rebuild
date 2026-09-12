import type { Store } from "@core";
import { showToast } from "../shared/toast";

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
// HMN-F-08 (2026-09-05): the Health module keeps its own offline queue
// (health/offlineQueue.ts), separate from the core Store's, and until now
// nothing drained it except the next health tap, which can be days away: a
// Took It whose write dropped sat on the phone and never reached the other
// device. `alsoFlush` is called on every "online" event right after the core
// reconnect, and once up front when the launch is online, so a held health
// log leaves the phone at the same moments a held task edit does.
//
// PLUMB-F-09 (2026-09-05): the browser's events were the ONLY signal, and on
// iOS navigator.onLine only flips when no interface is up at all. One bar of
// signal, a captive portal, a Supabase blip: onLine stayed true, the write
// threw, the toast said "Couldn't save" and the change was gone. The Store
// now notices a network-class failure itself and queues the write; what it
// cannot do is decide when to try again, because the core spine owns no
// clock. That is this file's other job now: when a write reports the signal
// dropped, retry on a backoff until something lands. A browser "online"
// event still short-circuits the wait, because that is real news.
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 300_000];

export function wireOfflineSync(store: Store, alsoFlush?: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // A launch that starts offline (airplane mode before the app ever opens)
  // gets no "offline" event to react to -- there was nothing to transition
  // from. Check the state directly once, up front.
  const startsOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (startsOffline) store.goOffline();
  else alsoFlush?.();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  // Try the queue again, later and later, until it drains. Only one retry is
  // ever in flight; a success resets the wait, so the NEXT drop starts at two
  // seconds again rather than five minutes.
  const retryLater = () => {
    if (stopped || timer !== null) return;
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    attempt++;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      store.reconnect().then(
        () => { attempt = 0; },
        () => { retryLater(); },
      );
      alsoFlush?.();
    }, wait);
  };

  const onOffline = () => { store.goOffline(); clear(); };
  // A failed reconnect (the network blipped back for a second and dropped
  // again) is not lost: reconnect() leaves whatever did not land still
  // queued (S3-Q14 core fix), so the next "online" event simply retries it.
  const onOnline = () => {
    clear();
    attempt = 0;
    store.reconnect().catch(() => { retryLater(); });
    alsoFlush?.();
  };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  // The Store's own report that a write found the signal gone. The browser
  // may never say a word about this one.
  store.onDropped(retryLater);
  // PLUMB-F-10 (2026-09-05): a held edit that lost to a newer one made
  // somewhere else is said out loud. Losing it silently is the thing the
  // finding is about; the record that survived is still named as a fact, and
  // nothing is offered to undo, because the newer edit is the one he made
  // last and meant.
  store.onKeptNewer((n) => {
    showToast({
      message: n === 1
        ? "Kept the newer edit · Your held change was older"
        : `Kept the newer edits · ${n} held changes were older`,
    });
  });
  // 2026-09-11: a queue the Store restored from a killed session loads with
  // the Store already online, so an online launch never replayed it, and a
  // later edit to a still-held capture went to a row the server never had.
  // Drain it now, with the same backoff as any other failed reconnect.
  if (!startsOffline && store.queueLen() > 0) store.reconnect().catch(() => { retryLater(); });
  return () => {
    stopped = true;
    clear();
    store.onDropped(null);
    store.onKeptNewer(null);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}
