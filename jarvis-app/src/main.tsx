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
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline shell is best-effort */
    });
  });
}
