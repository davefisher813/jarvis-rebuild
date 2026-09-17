import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import { capAfterNumber, liftTitle } from "../shared/casing";
import { MUSCLE_GROUPS, MUSCLE_LABEL } from "./muscles";
import { EQUIPMENT_KINDS, EQUIPMENT_LABEL } from "./equipment";
import type { LibraryRow } from "./libraryEdit";
import {
  BATCH_LABEL, EXECUTIONS, EXECUTION_LABEL, EXERCISE_TYPES, MOVEMENTS, MOVEMENT_LABEL, TYPE_LABEL,
  planBatch, type BatchField, type BatchMode, type ClassStore,
} from "./classify";

// SELECT MODE'S WRITE (handoff §3: "Add Select mode for categorizing multiple
// exercises together. Batch changes must distinguish Add, Replace, and Clear.
// Preview which fields will change before saving.")
//
// The reason this needs a sheet of its own rather than a menu is the third
// sentence. A batch edit is the one write in the library that can go wrong
// quietly and at scale: pick Replace when you meant Add across eleven
// exercises and you have silently deleted ten muscle assignments. So the
// verb is explicit, the field is named, and the sheet will not write until it
// has SHOWN you the before and after of every exercise it is about to touch --
// with the ones it leaves alone counted separately, so a preview of four
// changes out of eleven selected reads as four changes, not as eleven.

const MODE_LABEL: Record<BatchMode, string> = {
  add: "Add",
  replace: "Replace",
  clear: "Clear",
};

const MODE_NOTE: Record<BatchMode, string> = {
  add: "Keeps what is already there and adds to it",
  replace: "Swaps this one field, leaves every other field alone",
  clear: "Empties this one field, leaves every other field alone",
};

const FIELDS: BatchField[] = ["primary", "secondary", "equipment", "movement", "type", "execution", "tags"];

export default function BatchSheet({ rows, store, onSave, onCancel }: {
  /** The selected exercises, in the order the list shows them. */
  rows: LibraryRow[];
  store: ClassStore;
  onSave: (next: ClassStore, changed: number) => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState<BatchField>("primary");
  const [mode, setMode] = useState<BatchMode>("add");
  const [values, setValues] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [preview, setPreview] = useState(false);
  const tagRef = useRef<HTMLInputElement>(null);

  // One value for the single-answer axes, many for the list ones.
  const multi = field === "primary" || field === "secondary" || field === "tags";
  const options: { id: string; label: string }[] = useMemo(() => {
    switch (field) {
      case "primary":
      case "secondary": return MUSCLE_GROUPS.map((m) => ({ id: m, label: MUSCLE_LABEL[m] }));
      case "equipment": return EQUIPMENT_KINDS.map((e) => ({ id: e, label: EQUIPMENT_LABEL[e] }));
      case "movement": return MOVEMENTS.map((m) => ({ id: m, label: MOVEMENT_LABEL[m] }));
      case "type": return EXERCISE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }));
      case "execution": return EXECUTIONS.map((x) => ({ id: x, label: EXECUTION_LABEL[x] }));
      case "tags": return [];
    }
  }, [field]);

  const picked = field === "tags" ? tagText.split(",").map((t) => t.trim()).filter(Boolean) : values;
  const plan = useMemo(
    () => planBatch(store, rows.map((r) => ({ key: r.key, name: r.name, kind: r.kind })), field, mode, picked),
    [store, rows, field, mode, picked],
  );
  const ready = mode === "clear" || picked.length > 0;

  const toggle = (id: string) => {
    if (!multi) { setValues(values[0] === id ? [] : [id]); return; }
    setValues(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar
          title={`${rows.length} Selected`}
          onCancel={onCancel}
          saveLabel={preview ? "Apply" : "Preview"}
          saveDisabled={!ready || (preview && plan.changes.length === 0)}
          onSave={() => {
            if (!ready) return;
            if (!preview) { setPreview(true); return; }
            if (plan.changes.length === 0) return;
            onSave(plan.next, plan.changes.length);
          }}
        />
        <div className="sheet-form">
          {preview ? (
            <>
              {/* THE PREVIEW. Not a count, the actual rows: name, what it
                  says now, what it will say. */}
              <div className="grp xs-grp"><div className="eyebrow">{`${plan.changes.length} ${plan.changes.length === 1 ? "Change" : "Changes"}`}</div></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {plan.changes.map((ch) => (
                  <div className="row" key={ch.key}>
                    <div className="row-grow">
                      <div className="conn-name">{liftTitle(ch.name)}</div>
                      <div className="facts">
                        <span className="fact">{ch.before}</span>
                        <span className="fact lime">{ch.after}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {plan.changes.length === 0 && (
                  <div className="row"><div className="row-grow"><div className="conn-meta">Nothing to write</div></div></div>
                )}
              </div></div>
              <div className="pad-x"><div className="bp-sub">
                {plan.unchanged > 0
                  ? capAfterNumber(`${plan.unchanged} of the ${rows.length} selected already ${plan.unchanged === 1 ? "says" : "say"} this and stays as it is.`)
                  : capAfterNumber(`All ${rows.length} selected change.`)}
              </div></div>
              <div className="pad-x">
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setPreview(false)}>Back to the Picker</button>
              </div>
            </>
          ) : (
            <>
              <div className="grp xs-grp"><div className="eyebrow">Field</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* row-tap: chip strip, every inch of it is one of the field chips */}
                <div className="row xs-row">
                  <div className="chip-row chip-wrap-row">
                    {FIELDS.map((f) => (
                      <button key={f} type="button" className={"chip" + (field === f ? " active" : "")}
                        aria-pressed={field === f}
                        onClick={() => { setField(f); setValues([]); }}>
                        {BATCH_LABEL[f]}
                      </button>
                    ))}
                  </div>
                </div>
              </div></div>

              <div className="grp xs-grp"><div className="eyebrow">How</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* row-tap: chip strip, every inch of it is one of the three mode chips */}
                <div className="row xs-row">
                  <div className="chip-row chip-wrap-row">
                    {(["add", "replace", "clear"] as BatchMode[]).map((m) => (
                      <button key={m} type="button" className={"chip" + (mode === m ? " active" : "")}
                        aria-pressed={mode === m} onClick={() => setMode(m)}>
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row xs-row"><div className="row-grow"><div className="conn-meta">{MODE_NOTE[mode]}</div></div></div>
              </div></div>

              {mode !== "clear" && (
                <>
                  <div className="grp xs-grp"><div className="eyebrow">{BATCH_LABEL[field]}</div></div>
                  <div className="pad-x"><div className="card xs-group">
                    {field === "tags" ? (
                      // A tap anywhere on the row lands in the field (Dave 2026-09-15: "I want all rows clickable").
                      <div className="row xs-row" onClick={() => tagRef.current?.focus()}>
                        <div className="xs-label">Tags</div>
                        <input ref={tagRef} className="xs-input" value={tagText} placeholder="Comma Separated" aria-label="Tags"
                          onChange={(e) => setTagText(e.target.value)} />
                      </div>
                    ) : (
                      // row-tap: chip strip, every inch of it is one of the value chips
                      <div className="row xs-row">
                        <div className="chip-row chip-wrap-row">
                          {options.map((o) => (
                            <button key={o.id} type="button" className={"chip" + (values.includes(o.id) ? " active" : "")}
                              aria-pressed={values.includes(o.id)} onClick={() => toggle(o.id)}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div></div>
                </>
              )}

              {/* ONE LINE, NOT THREE (2026-09-16, Dave: "modals not done...
                  grey subtext all over the place"; polish rule 3: "Essential
                  metadata gets one short readable line"). Two grey lines sat
                  stacked here and the second promised what the button beside
                  it already says: the save action reads Preview until it has
                  been pressed. The fact -- how many of the selected this
                  would actually touch -- is the one worth a line. */}
              <div className="pad-x"><div className="bp-sub">
                {ready
                  ? capAfterNumber(`${plan.changes.length} of the ${rows.length} selected would change`)
                  : "Pick what to write, then preview it"}
              </div></div>
            </>
          )}
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
