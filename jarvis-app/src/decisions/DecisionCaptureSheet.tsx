import { useState } from "react";
import { createPortal } from "react-dom";
import type { DecisionLinkType } from "./types";

// The capture sheet (Screen 03) and the supersede sheet (Screen 05), one
// component: a supersede is a capture with Attached To and Ruled Out carried
// over and the Decided/Why fields empty. Two fields required by the spec's
// spirit, one by its letter: the decision line. Save is never disabled;
// missing Why saves anyway and the record shows "No reason recorded". A
// blocked Save is a confirm gate, which is banned.

export interface AttachOption { type: DecisionLinkType; id: string; label: string }

export interface DecisionDraft {
  decision: string;
  why?: string;
  ruledOut?: string[];
  linkedType?: DecisionLinkType;
  linkedId?: string;
  linkedLabel?: string;
  revisitOn?: string;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDaysISO = (iso: string, n: number) =>
  new Date(new Date(iso + "T00:00:00").getTime() + n * 86400000).toISOString().slice(0, 10);

export default function DecisionCaptureSheet({
  mode = "new",
  initial,
  attachOptions,
  onSave,
  onCancel,
}: {
  // supersede: Screen 05, prefilled links, empty decision.
  mode?: "new" | "supersede";
  initial?: Partial<DecisionDraft>;
  attachOptions: AttachOption[];
  onSave: (draft: DecisionDraft) => void;
  onCancel: () => void;
}) {
  const [decision, setDecision] = useState(initial?.decision ?? "");
  const [why, setWhy] = useState(initial?.why ?? "");
  const [ruledOut, setRuledOut] = useState<string[]>(initial?.ruledOut ?? []);
  const [ruleDraft, setRuleDraft] = useState("");
  const [attach, setAttach] = useState<string>(initial?.linkedId ?? "");
  const [revisit, setRevisit] = useState(initial?.revisitOn ?? "");
  const [err, setErr] = useState(false);
  const today = todayISO();
  const revisitMode = revisit === "" ? "none" : revisit === addDaysISO(today, 7) ? "week" : revisit === addDaysISO(today, 30) ? "month" : "pick";

  const addRule = () => {
    const v = ruleDraft.trim();
    if (!v) return;
    if (!ruledOut.some((r) => r.toLowerCase() === v.toLowerCase())) setRuledOut([...ruledOut, v]);
    setRuleDraft("");
  };

  const save = () => {
    if (!decision.trim()) { setErr(true); return; }
    const opt = attachOptions.find((o) => o.id === attach);
    onSave({
      decision: decision.trim(),
      why: why.trim() || undefined,
      ruledOut: ruledOut.length ? ruledOut : undefined,
      linkedType: opt?.type,
      linkedId: opt?.id,
      linkedLabel: opt?.label,
      revisitOn: revisit || undefined,
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "supersede" ? "New Call" : "New Decision"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">What You Decided <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="e.g. Fall clinics run Saturdays only"
              value={decision}
              onChange={(e) => { setDecision(e.target.value); if (err) setErr(false); }}
            />
            {err && <div className="input-error">Add the decision.</div>}
          </div>

          <div className="field">
            <label className="input-label">Why</label>
            <input
              className="input"
              placeholder="The reason you will forget · One line is enough"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </div>

          <div className="field">
            <div className="input-label">Ruled Out</div>
            {ruledOut.length > 0 && (
              <div className="chip-row">
                {ruledOut.map((r) => (
                  <div key={r} className="chip active" role="button" tabIndex={0} onClick={() => setRuledOut(ruledOut.filter((x) => x !== r))}>{r}</div>
                ))}
              </div>
            )}
            <input
              className="input field-gap"
              placeholder="Option you closed · Enter adds"
              value={ruleDraft}
              onChange={(e) => setRuleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }}
              onBlur={addRule}
            />
          </div>

          <div className="field">
            <div className="input-label">Revisit</div>
            <div className="segmented">
              <div className={"seg" + (revisitMode === "none" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit("")}>None</div>
              <div className={"seg" + (revisitMode === "week" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(addDaysISO(today, 7))}>1 Week</div>
              <div className={"seg" + (revisitMode === "month" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(addDaysISO(today, 30))}>1 Month</div>
              <div className={"seg" + (revisitMode === "pick" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(revisitMode === "pick" && revisit ? revisit : addDaysISO(today, 14))}>Pick</div>
            </div>
            {revisitMode === "pick" && (
              <input type="date" className="input field-gap" min={today} value={revisit} onChange={(e) => setRevisit(e.target.value)} />
            )}
          </div>

          {attachOptions.length > 0 && (
            <div className="field">
              <div className="input-label">Attached To</div>
              <div className="chip-row">
                <div className={"chip" + (attach === "" ? " active" : "")} role="button" tabIndex={0} onClick={() => setAttach("")}>None</div>
                {attachOptions.map((o) => (
                  <div key={o.id} className={"chip" + (attach === o.id ? " active" : "")} role="button" tabIndex={0} onClick={() => setAttach(o.id)}>{o.label}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
