import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { AskFn, ConflictAsk, ConflictChoice } from "../withConflictCheck";

// THE CALM PROMPT BEHIND EVERY TIME WRITE (2026-10-01). One line naming what
// the time lands on, and three ways out: use the nearest free time, book it
// anyway, or back out. It never refuses; Book Anyway always writes. Same shell
// as OverlapSheet (scrim, card, handle, eyebrow, block buttons) so it reads as
// one of the app's own sheets, not a new kind of alert.

export default function ConflictSheet({
  ask,
  onChoose,
}: {
  ask: ConflictAsk;
  onChoose: (c: ConflictChoice) => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={() => onChoose("cancel")}>
      <div className="card" role="dialog" aria-label="Time Conflict" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{ask.tone === "conflict" ? "Already Booked" : "Heads Up"}</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">{ask.line}</div>
          <div className="plan-sub">
            {ask.tone === "conflict" ? "Something else is booked then, and it is your call." : "That time is flexible, so this one is up to you."}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          {ask.altLabel && (
            <button className="btn btn-primary btn-block" onClick={() => onChoose("alt")}>Use {ask.altLabel}</button>
          )}
          <button className={"btn btn-block " + (ask.altLabel ? "btn-secondary" : "btn-primary")} onClick={() => onChoose("book")}>Book Anyway</button>
          <button className="btn btn-tertiary btn-block" onClick={() => onChoose("cancel")}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A promise-shaped door onto the sheet. `ask` resolves with the person's
 * choice, so a commit path reads top to bottom (`await ask(...)`) instead of
 * being split across a state machine. Render `sheet` once, anywhere in the
 * flow's tree.
 *
 * A second ask while one is open cancels the first: two prompts for one
 * person at one moment is a bug, never a queue.
 */
export function useConflictAsk(): { ask: AskFn; sheet: ReactElement | null } {
  const [open, setOpen] = useState<ConflictAsk | null>(null);
  const resolver = useRef<((c: ConflictChoice) => void) | null>(null);
  const ask = useCallback<AskFn>((a) => new Promise<ConflictChoice>((resolve) => {
    resolver.current?.("cancel");
    resolver.current = resolve;
    setOpen(a);
  }), []);
  const choose = useCallback((c: ConflictChoice) => {
    const r = resolver.current;
    resolver.current = null;
    setOpen(null);
    r?.(c);
  }, []);
  // A flow that unmounts with the sheet up must not leave a write hanging.
  useEffect(() => () => { resolver.current?.("cancel"); resolver.current = null; }, []);
  return { ask, sheet: open ? <ConflictSheet ask={open} onChoose={choose} /> : null };
}
