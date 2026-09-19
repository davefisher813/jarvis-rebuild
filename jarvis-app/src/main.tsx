import React from "react";
import ReactDOM from "react-dom/client";
import { AppearanceProvider } from "./appearance/AppearanceProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { emit } from "./events";
import { startEventPipeline } from "./events/pipeline";
import { supabase } from "./auth/supabaseClient";
import App from "./App";
import ErrorBoundary from "./monitoring/ErrorBoundary";
import { initMonitoring } from "./monitoring/monitor";
import { startAppUrlListener } from "./native/appUrl";
import { trackVisualViewport } from "./shared/viewport";
import { checkBuild } from "./shared/buildCheck";

import "./styles/jarvis-design-system.css";
import "./styles/uniformity.css";
import "./styles/components.css";
import "./styles/editor.css";
import "./styles/ruled.css";

initMonitoring();
// A sheet is fixed to the layout viewport, and iOS moves the VISIBLE one when
// the keyboard comes up. This states where the visible one is, so the sheet can
// sit in it and its Cancel and Save stay reachable (see shared/viewport.ts).
trackVisualViewport();
// UP-LAUNCH-12 (2026-09-05): URLs that arrive from outside, on the phone.
// The Google sign-in sheet's callback comes back this way, and so will the
// magic link and the widget deep links. A no-op on the web and on a native
// build with no @capacitor/app pod yet.
void startAppUrlListener();

// Catalog V3.1 motion: lists stagger on FIRST PAINT only. The class lives on
// body for the boot moment and is gone before any tab switch, so switches
// stay instant per the standing law (Dave 2026-07-29).
if (typeof document !== "undefined") {
  document.body.classList.add("boot-stagger");
  setTimeout(() => document.body.classList.remove("boot-stagger"), 1400);
}
emit({ type: "app.opened" });
// Durable event pipeline (Session 6.5): connects the Supabase sink (null in
// demo mode = queue-only), backfills Time Sense once, scores yesterday's plan.
startEventPipeline(supabase);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppearanceProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AppearanceProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Register the PWA service worker only when served over http(s) (skips the
// file-based single-file demo, where service workers are unavailable).
// On every load we check for an updated SW and, when one is found, let it take
// over right away (the SW calls skipWaiting + clients.claim). A controllerchange
// then triggers a one-time reload so the user always lands on fresh code instead
// of a stale cached shell (the cause of the earlier black-screen after deploy).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
  // AND IT ASKS AGAIN EVERY TIME THE APP COMES BACK TO THE FRONT
  // (2026-09-16, Dave: "I don't see any difference... it's been the same push
  // forever").
  //
  // This is the bug that made a whole day of shipped work invisible. The
  // registration asked for an update on `load` and nowhere else -- and a
  // home-screen app on iOS is SUSPENDED AND RESUMED, not closed and loaded.
  // Tapping its icon restores the process: no `load`, no navigation, so the
  // network-first HTML handler in sw.js never runs either. Both of the paths
  // that could notice a deploy are navigation-shaped, and resuming is not a
  // navigation. Short of force-quitting the app, nothing ever checked, and
  // the person is looking at whatever bundle was current the last time they
  // cold-started it.
  //
  // visibilitychange is the moment that actually matters: it is the instant
  // before somebody looks at the screen. pageshow covers the bfcache restore
  // Safari does on a back-swipe, which is the same shape of problem.
  // Throttled, because foregrounding is common and a version check is a
  // network round trip; 60s is far below how often a deploy can land and far
  // above how often an app is flicked in and out of.
  // reg.update() is kept, but it is NOT the fix and cannot be: the browser
  // installs a new worker only when /sw.js differs byte for byte, and sw.js is
  // a static file that is identical across every deploy that does not edit it.
  // The real check is shared/buildCheck.ts, which compares the bundle this
  // code is running from against the one the deployed HTML names.
  const UPDATE_EVERY_MS = 60_000;
  let lastCheck = 0;
  const check = (reg: ServiceWorkerRegistration | null) => {
    const now = Date.now();
    if (now - lastCheck < UPDATE_EVERY_MS) return;
    lastCheck = now;
    void reg?.update().catch(() => { /* offline: the next foreground retries */ });
    void checkBuild({ fetchImpl: fetch.bind(window), reload: () => window.location.reload(), moduleUrl: import.meta.url });
  };
  const watch = (reg: ServiceWorkerRegistration | null) => {
    check(reg);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check(reg);
    });
    window.addEventListener("pageshow", () => check(reg));
  };
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(watch).catch(() => {
      // The offline shell is best-effort, but the build check is not: a
      // worker that failed to register is the case MOST likely to be stuck.
      watch(null);
    });
  });
}


// Toggle a body class while any bottom sheet is open so the floating capture bar
// hides. Uses a class (not the :has selector) to work on every browser, including
// older iOS Safari. Watches childList only, so toggling the class cannot re-trigger.
// `overlay-open` rides along (2026-09-06, Dave from his phone: "when lists
// inside modals render I can't scroll them. The pages behind them end up
// scrolling instead"). It pins the page scroller while anything modal is up,
// so there is nothing behind the scrim left to move. It is a SECOND class
// rather than a widened `sheet-open`, because sheet-open also hides the tab
// bar and the capture bar, and a dropdown on a list head must not do that.
if (typeof document !== "undefined") {
  const syncSheetOpen = () => {
    document.body.classList.toggle("sheet-open", !!document.querySelector(".sheet-scrim"));
    document.body.classList.toggle("overlay-open", !!document.querySelector(".sheet-scrim, .hmenu-scrim"));
    // 2026-09-09: the root wears it too, read straight off the body so there
    // is one decision and not two. Body overflow is supposed to propagate to
    // the viewport while the root is `visible`, and on iOS that has not always
    // been true, so the document gets pinned by name rather than by
    // inheritance. Harmless everywhere the propagation already works.
    document.documentElement.classList.toggle("overlay-open", document.body.classList.contains("overlay-open"));
  };
  new MutationObserver(syncSheetOpen).observe(document.body, { childList: true, subtree: true });
}
