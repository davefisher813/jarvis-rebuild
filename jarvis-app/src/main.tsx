import React from "react";
import ReactDOM from "react-dom/client";
import { AppearanceProvider } from "./appearance/AppearanceProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { emit } from "./events";
import App from "./App";
import ErrorBoundary from "./monitoring/ErrorBoundary";
import { initMonitoring } from "./monitoring/monitor";

import "./styles/jarvis-design-system.css";
import "./styles/uniformity.css";
import "./styles/components.css";

initMonitoring();
emit({ type: "app.opened" });

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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update();
    }).catch(() => {
      /* offline shell is best-effort */
    });
  });
}


// Toggle a body class while any bottom sheet is open so the floating capture bar
// hides. Uses a class (not the :has selector) to work on every browser, including
// older iOS Safari. Watches childList only, so toggling the class cannot re-trigger.
if (typeof document !== "undefined") {
  const syncSheetOpen = () => {
    document.body.classList.toggle("sheet-open", !!document.querySelector(".sheet-scrim"));
  };
  new MutationObserver(syncSheetOpen).observe(document.body, { childList: true, subtree: true });
}
