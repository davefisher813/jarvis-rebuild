import { createPortal } from "react-dom";
import { useState } from "react";
import type { Person } from "./types";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";

// Call Prep Card (addendum item 2, approved preview 2026-08-15). Opens
// INSTANTLY with everything the app already knows about this person;
// sections render only when they have data (a section with nothing to say
// says nothing). Call is the one primary action: it dials via tel: and logs
// ONE attempt automatically, with undo on the toast. Never duration, never
// outcome. After dialing, a capture line appears so what came out of the
// call lands as a linked note without leaving the card.
//
// This is THE card: any surface that offers a person action opens this same
// component (the anti-drift rule from the coverage map applies to cards as
// much as primitives).

function ago(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

export default function CallPrepSheet({
  person,
  linkedNotes = [],
  onCall,
  onUndoCall,
  onCaptureNote,
  onClose,
}: {
  person: Person;
  linkedNotes?: { id: string; title: string }[];
  // Logs the attempt; resolves the undo payload. The sheet stays dumb about
  // services on purpose (same principle as PersonDetail).
  onCall: () => Promise<{ prior: string | undefined } | null>;
  onUndoCall: (prior: string | undefined) => Promise<void>;
  onCaptureNote?: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { name, relationship, notes, phone, register, flagged, lastCallAttempt } = person.data;
  const [dialed, setDialed] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const lastCalled = ago(lastCallAttempt || undefined);
  const writeStyle = flagged
    ? "With care, always professional"
    : register === "friend" ? "Like a close friend"
    : register === "casual" ? "Casual"
    : register === "professional" ? "Professional"
    : undefined;

  const call = async () => {
    // Dial first: the phone app opening must never wait on a write.
    window.location.href = "tel:" + (phone ?? "").replace(/[^+\d]/g, "");
    setDialed(true);
    let payload: { prior: string | undefined } | null = null;
    const ok = await attemptWrite(async () => { payload = await onCall(); });
    if (!ok || !payload) return;
    const prior = (payload as { prior: string | undefined }).prior;
    showToast({
      message: "Call logged",
      actionLabel: "Undo",
      onAction: () => void attemptWrite(() => onUndoCall(prior)),
    });
  };

  const capture = async () => {
    const t = captureText.trim();
    if (!t || !onCaptureNote) return;
    const ok = await attemptWrite(async () => { await onCaptureNote(t); });
    if (!ok) return;
    setCaptureText("");
    showToast({ message: "Saved to a note linked to " + name });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Call Prep</div></div>
        <div className="pad-x sheet-form">
          <div className="row">
            <div className="row-stack">
              <div className="conn-name">{name}</div>
              {lastCalled && <div className="conn-meta">You called {lastCalled}</div>}
            </div>
          </div>
          {relationship && (
            <div className="row"><div className="row-stack"><div className="eyebrow">Relationship</div><div className="conn-meta">{relationship}</div></div></div>
          )}
          {writeStyle && (
            <div className="row"><div className="row-stack"><div className="eyebrow">JARVIS Writes</div><div className="conn-meta">{writeStyle}</div></div></div>
          )}
          {notes && (
            <div className="row"><div className="row-stack"><div className="eyebrow">Notes</div><div className="conn-meta">{notes}</div></div></div>
          )}
          {linkedNotes.length > 0 && (
            <div className="row"><div className="row-stack">
              <div className="eyebrow">Linked Notes</div>
              {linkedNotes.slice(0, 3).map((n) => (
                <div key={n.id} className="conn-meta">{n.title}</div>
              ))}
            </div></div>
          )}

          {dialed && onCaptureNote && (
            <div className="field">
              <label className="input-label">From the Call</label>
              <textarea
                className="input input-multiline"
                placeholder="What came out of it?"
                value={captureText}
                onChange={(e) => setCaptureText(e.target.value)}
              />
            </div>
          )}

          <div className="sheet-actions">
            {phone && !dialed && (
              <button className="btn btn-primary btn-block" onClick={() => void call()}>Call</button>
            )}
            {dialed && captureText.trim() && (
              <button className="btn btn-primary btn-block" onClick={() => void capture()}>Save Note</button>
            )}
            <button className="btn btn-secondary btn-block" onClick={onClose}>{dialed ? "Done" : "Cancel"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
