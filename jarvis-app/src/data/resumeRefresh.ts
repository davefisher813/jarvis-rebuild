import type { Store } from "@core";
import { ALL_LISTS, notifyFreshLists } from "./store";

// UP-PLAT-06 (2026-09-06), option B, half one: PICK THE PHONE BACK UP AND IT
// IS RIGHT.
//
// Convergence between two devices relied entirely on the Store's three-second
// list cache and on a surface happening to re-list (data/CachedAdapter.ts's
// stale-while-revalidate). Nothing anywhere listened for the app coming back
// to the foreground: a grep for visibilitychange found one caller, and it
// re-arms notifications, not data. So a task added on the laptop at lunch was
// still missing from the phone at dinner unless something on screen happened
// to trigger a list.
//
// Two things have to happen on resume, in this order. The Store's cached
// lists have to go, or a re-list inside the three-second window answers from
// the same stale copy; then every subscribed surface is told, so it re-lists
// at all. Cheap: one cache clear and one round trip per surface, only when
// the app actually comes back.
//
// WHY visibilitychange AND NOT @capacitor/app: the plugin's appStateChange is
// the stronger signal on iOS, but it is not a dependency of this app and
// cannot be added from here without touching the shared node_modules (see the
// final report). visibilitychange is what WKWebView fires on background and
// foreground, it is what shell/AppShell.tsx already treats as the app's
// foreground signal (TODAY-F-15's reminder re-arm), and it is the only one
// that also works in the browser and the PWA. Adding appStateChange later is
// one more listener calling the same function.
export function wireResumeRefresh(store: Store, notify: (t: string) => void = notifyFreshLists): () => void {
  if (typeof document === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    store.invalidateAll();
    notify(ALL_LISTS);
  };
  document.addEventListener("visibilitychange", onVisible);
  // Safari and the WKWebView both restore a backgrounded page from the
  // back/forward cache without a visibilitychange in some paths; pageshow
  // with persisted true is that case, and it is the same resume.
  const onShow = (e: Event) => { if ((e as PageTransitionEvent).persisted) onVisible(); };
  window.addEventListener("pageshow", onShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onShow);
  };
}
