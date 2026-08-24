import { createPortal } from "react-dom";
import { useState } from "react";
import type { Recurrence, BillInfo } from "../notes/types";

export interface BillDraft {
  text: string;
  due: string; // "" = none
  recurrence: Recurrence | null;
  bill: BillInfo;
}

const TRASH = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

// The bill sheet (Money v1). ~10 bills entered once, then it runs itself, so
// this form optimizes for the first five minutes: name, amount, when, done.
export default function BillSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit";
  initial?: BillDraft;
  onSave: (d: BillDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.bill.amount) : "");
  const [due, setDue] = useState(initial?.due ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(initial?.recurrence ?? "monthly");
  const [autopay, setAutopay] = useState(!!initial?.bill.autopay);
  const [payUrl, setPayUrl] = useState(initial?.bill.payUrl ?? "");
  const [touched, setTouched] = useState(false);

  const valid = text.trim().length > 0 && amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    const url = payUrl.trim();
    onSave({
      text: text.trim(),
      due,
      recurrence,
      bill: {
        amount: Number(amount),
        ...(autopay ? { autopay: true } : {}),
        // Accept bare domains: "coned.com" becomes a working link.
        ...(url ? { payUrl: /^https?:\/\//i.test(url) ? url : "https://" + url } : {}),
      },
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Bill" : "Edit Bill"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className={"input" + (touched && !text.trim() ? " input-error" : "")} placeholder="e.g. Rent" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Amount (USD)</div>
            <input className={"input" + (touched && !valid && text.trim() ? " input-error" : "")} inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a name and an amount.</div>}
          </div>
          <div className="field">
            <div className="input-label">Next Due</div>
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Repeats</div>
            <div className="segmented">
              <button type="button" className={"seg" + (recurrence === "monthly" ? " active" : "")} onClick={() => setRecurrence("monthly")}>Monthly</button>
              <button type="button" className={"seg" + (recurrence === "weekly" ? " active" : "")} onClick={() => setRecurrence("weekly")}>Weekly</button>
              <button type="button" className={"seg" + (recurrence === null ? " active" : "")} onClick={() => setRecurrence(null)}>Once</button>
            </div>
          </div>
          <div className="field">
            <div className="input-label">Autopay</div>
            {/* The truthful frame: this changes what JARVIS SAYS about the
                bill ("set to autopay", never "paid"), not what happens. */}
            <div className="segmented">
              <button type="button" className={"seg" + (!autopay ? " active" : "")} onClick={() => setAutopay(false)}>I pay it</button>
              <button type="button" className={"seg" + (autopay ? " active" : "")} onClick={() => setAutopay(true)}>It pays itself</button>
            </div>
          </div>
          <div className="field">
            <div className="input-label">Pay Link</div>
            <input type="url" className="input" placeholder="Pay Link · optional" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onDelete && (
            <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>{TRASH}Delete Bill</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
