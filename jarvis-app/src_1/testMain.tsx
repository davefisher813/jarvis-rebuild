import React from "react";
import ReactDOM from "react-dom/client";
import { AppearanceProvider } from "./appearance/AppearanceProvider";
import TestBench from "./testpanel/TestBench";

import "./styles/jarvis-design-system.css";
import "./styles/uniformity.css";
import "./styles/components.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <div className="app-shell"><div className="app-scroll"><TestBench /></div></div>
    </AppearanceProvider>
  </React.StrictMode>,
);
