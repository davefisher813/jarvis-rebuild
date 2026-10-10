import { useEffect, useState } from "react";
import { subscribeToast, hideToast, type ToastState } from "./toast";

// Renders the current toast docked just above the tab bar. Mounted once by the
// app shell; reacts to showToast/hideToast from anywhere.
export default function ToastHost() {
  const [t, setT] = useState<ToastState | null>(null);
  // Each new message is a new arrival: the key remounts the card so its short
  // rise and fade (components.css, toastIn) plays for every message, not only
  // the first one after a quiet spell (premium feel, 2026-10-10).
  const [arrival, setArrival] = useState(0);
  useEffect(() => subscribeToast((next) => { setT(next); if (next) setArrival((n) => n + 1); }), []);
  if (!t) return null;
  return (
    <div className="toast-dock">
      <div className="toast" role="status" key={arrival}>
        <span className="toast-msg">{t.message}</span>
        {/* Both, never just the label: a capsule with nothing behind it is
            a button that does nothing, which is the one thing this app does
            not ship (audit 2026-09-16). See toast.ts's hasAction. */}
        {t.actionLabel && t.onAction && (
          <button className="toast-action" onClick={() => { t.onAction!(); hideToast(); }}>{t.actionLabel}</button>
        )}
      </div>
    </div>
  );
}
