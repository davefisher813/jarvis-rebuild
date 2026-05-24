import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppearanceProvider } from "./appearance/AppearanceProvider";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import { emit } from "./events";

// Locked visual truth, then the approved RULE 9 components.
import "./styles/jarvis-design-system.css";
import "./styles/uniformity.css";
import "./styles/components.css";

emit({ type: "app.opened" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </AppearanceProvider>
  </React.StrictMode>,
);
