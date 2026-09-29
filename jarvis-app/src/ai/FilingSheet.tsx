import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalBrainMemory } from "../data/NotesProvider";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import {
  type BrainMemoryCategory,
  type BrainMemorySource,
} from "./brainMemory";
import { fileMemory, showFilingConfirm } from "./filingIntake";

// "LOG THE DECISION" / "REMEMBER THIS" (Brain Manual v1, 2026-09-27).
//
// One sheet, three fields max (flow-doc §4.2): what, why (optional,
// decisions only), and a category picker for Remember This (default Fact).
// Date is auto. The sheet owns the write and the confirm toast + Undo --
// the task sheet, the event sheet and the + menu all file the same way.
//
// QuickCapture's sheet atoms (.sheet-scrim, .card, .sheet-handle,
// .grp/.eyebrow, .pad-x .sheet-form, .input, .sheet-actions,
// .btn .btn-primary/.btn-secondary .btn-block); the category picker is the
// task sheet's own .segmented control. Nothing new was styled.
//
// 2026-09-29 (chat "Log It", email "File It"): the "what" box is the app's
// multiline field (.input-multiline, as Smart Paste uses), because a whole
// chat message or an email subject and preview does not fit on one line.
// Three guarantees the longer text made worth stating:
//   - A DOUBLE TAP CANNOT FILE TWICE. `saving` is state and lands a render
//     late, so two taps in one frame both read it as false; the ref is the
//     guard that is true the instant the first tap begins.
//   - A FAILED SAVE KEEPS WHAT WAS TYPED. attemptWrite reports the failure and
//     the sheet stays open with every field as it was.
//   - NO BRAIN, NO SAVE. If the service goes away while the sheet is open
//     the sheet says so and closes; nothing is written. Cancel, the scrim and
//     Escape write nothing at any point.

const REMEMBER_CATEGORIES: { key: BrainMemoryCategory; label: string }[] = [
  { key: "philosophy", label: "Philosophy" },
  { key: "value", label: "Value" },
  { key: "fact", label: "Fact" },
];

export default function FilingSheet({
  mode,
  initialText,
  linkedItemIds,
  source,
  onClose,
}: {
  mode: "decision" | "remember";
  initialText: string;
  linkedItemIds?: string[];
  source: BrainMemorySource;
  onClose: () => void;
}) {
  const brain = useOptionalBrainMemory();
  const [what, setWhat] = useState(initialText);
  const [why, setWhy] = useState("");
  const [category, setCategory] = useState<BrainMemoryCategory>("fact");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (brain) return;
    showToast({ message: "Brain Unavailable · Nothing Saved" });
    onClose();
  }, [brain, onClose]);

  const save = async () => {
    if (!brain || saving || inFlight.current) return;
    const text = what.trim();
    if (!text) return;
    const cat: BrainMemoryCategory = mode === "decision" ? "decision" : category;
    // The payload shape is filingIntake's fileMemory (decision date/status,
    // why, linked ids); the service owns the store write + events.
    const data = fileMemory({
      category: cat,
      text,
      why: mode === "decision" ? why : undefined,
      source,
      linkedItemIds,
    });
    inFlight.current = true;
    setSaving(true);
    let id: string | null = null;
    const ok = await attemptWrite(async () => { id = await brain.file(data); });
    setSaving(false);
    // Released only when the save did not land: after a success the sheet is
    // on its way out and must not take a third tap.
    if (!ok || !id) { inFlight.current = false; return; }
    const filedId = id;
    // The shared confirm: destination line + Undo for UNDO_MS (8s).
    // showFilingConfirm is the app's one toast (shared/toast.ts) -- no
    // second toast built.
    showFilingConfirm(cat, () => void brain.unfile(filedId), brain.pending());
    onClose();
  };

  return createPortal(
    <div className="sheet-scrim" onClick={() => { if (!saving) onClose(); }}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "decision" ? "Log the Decision" : "Remember This"}</div></div>
        <div className="pad-x sheet-form">
          <textarea
            className="input input-multiline"
            aria-label={mode === "decision" ? "The Decision" : "What to Remember"}
            placeholder={mode === "decision" ? "The Decision" : "What to Remember"}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            autoFocus={mode === "remember"}
          />
          {mode === "decision" ? (
            <input
              className="input"
              aria-label="Why, Optional"
              placeholder="Why (Optional)"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          ) : (
            <div className="segmented" role="radiogroup" aria-label="Kind">
              {REMEMBER_CATEGORIES.map((c) => (
                <div
                  key={c.key}
                  className={"seg" + (category === c.key ? " active" : "")}
                  role="radio"
                  aria-checked={category === c.key}
                  tabIndex={0}
                  onClick={() => setCategory(c.key)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCategory(c.key); } }}
                >
                  {c.label}
                </div>
              ))}
            </div>
          )}
          <div className="sheet-actions">
            <button className="btn btn-primary btn-block" onClick={() => void save()} disabled={!brain || !what.trim() || saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn btn-secondary btn-block" onClick={onClose} disabled={saving}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
