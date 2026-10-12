// THE BULK TRAY (Email v1 spec section 11, V04). Fixed above the tab bar in the
// shell's select-bar host, like every select bar in the app, so it cannot
// scroll away from the selection it acts on. Four verbs: Read, Unread, Archive,
// Delete. Delete is the one red on the tray (spec 2.8) and says what it does
// beneath: it moves the selection to Gmail's Trash, which is recoverable, so
// the tap is the approval and no confirm sheet stands in front of it. At zero
// the verbs are present and inert, so the tray never jumps under a thumb.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TRASH_HELPER } from "./copy";
import { TRAY_LABEL, type TrayVerb } from "./bulk";

export default function MailSelectTray({ count, busy, onVerb }: {
  count: number;
  busy: boolean;
  onVerb: (verb: TrayVerb) => void;
}) {
  useEffect(() => {
    document.body.classList.add("selecting");
    return () => document.body.classList.remove("selecting");
  }, []);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById("select-bar-host")); }, []);
  const off = count === 0 || busy;
  const tray = (
    <div className="select-bar email-tray" role="toolbar" aria-label={TRAY_LABEL.read + ", " + TRAY_LABEL.unread + ", " + TRAY_LABEL.archive + ", " + TRAY_LABEL.delete}>
      <div className="email-tray-acts">
        <button className="btn btn-secondary btn-sm email-tray-btn" disabled={off} onClick={() => onVerb("read")}>{TRAY_LABEL.read}</button>
        <button className="btn btn-secondary btn-sm email-tray-btn" disabled={off} onClick={() => onVerb("unread")}>{TRAY_LABEL.unread}</button>
        <button className="btn btn-secondary btn-sm email-tray-btn" disabled={off} onClick={() => onVerb("archive")}>{TRAY_LABEL.archive}</button>
        <button className="btn btn-primary btn-sm email-tray-btn" disabled={off} onClick={() => onVerb("delete")}>{TRAY_LABEL.delete}</button>
      </div>
      <div className="email-tray-help">{TRASH_HELPER}</div>
    </div>
  );
  // Without the shell (a test, a bench) the tray draws in place.
  return host ? createPortal(tray, host) : tray;
}
