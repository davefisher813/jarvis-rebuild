import { useEffect, useState } from "react";
import { subscribeToast, hideToast, type ToastState } from "./toast";

// Renders the current toast docked just above the tab bar. Mounted once by the
// app shell; reacts to showToast/hideToast from anywhere.
export default function ToastHost() {
  const [t, setT] = useState<ToastState | null>(null);
  useEffect(() => subscribeToast(setT), []);
  if (!t) return null;
  return (
    <div className="toast-dock">
      <div className="toast" role="status">
        <span className="toast-msg">{t.message}</span>
        {t.actionLabel && (
          <button className="toast-action" onClick={() => { t.onAction?.(); hideToast(); }}>{t.actionLabel}</button>
        )}
      </div>
    </div>
  );
}
