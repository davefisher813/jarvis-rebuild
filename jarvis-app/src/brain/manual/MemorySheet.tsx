import { useState } from "react";
import { useBrainMemory } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import {
  categoryLabel,
  filedFromLabel,
  type BrainMemoryCategory,
  type BrainMemoryRow,
  filedToastText,
} from "../../ai/brainMemory";
import { decisionStateLabel } from "../../ai/brainMemoryService";
import { fileMemory } from "../../ai/filingIntake";
import { formatFiledDate } from "./triage";

const CATS: BrainMemoryCategory[] = ["fact", "decision", "philosophy", "value", "voice"];

type Mode = "view" | "edit" | "forget";

/**
 * The memory detail screen (brief §4): what it is, where it was filed from,
 * and, for decisions, the why, the date, and the supersede trail. Edit
 * rewrites the row in place; Forget asks once ("Forget this? Jarvis will
 * stop using it.") and then the row is fully gone, so it stops reaching
 * prompt assembly. Revisit on a decision files the new call as a new row
 * and archives this one with the link, never deleting it.
 */
export default function MemorySheet({
  row,
  onClose,
  onChanged,
}: {
  row: BrainMemoryRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const svc = useBrainMemory();
  const [mode, setMode] = useState<Mode>("view");
  const [text, setText] = useState(row.data.text);
  const [why, setWhy] = useState(row.data.why ?? "");
  const [category, setCategory] = useState<BrainMemoryCategory>(row.data.category);
  const [revisitText, setRevisitText] = useState("");
  const [revisitWhy, setRevisitWhy] = useState("");
  const [revisiting, setRevisiting] = useState(false);
  const [saving, setSaving] = useState(false);

  const isDecision = row.data.category === "decision";

  const doEdit = async () => {
    if (saving || !text.trim()) return;
    setSaving(true);
    const ok = await attemptWrite(() =>
      svc.update(row.id, {
        text: text.trim(),
        why: isDecision ? why.trim() || undefined : row.data.why,
        category,
      }),
    );
    setSaving(false);
    if (!ok) return;
    showToast({ message: svc.pending() ? "Edited · Will Sync" : "Saved ✓" });
    onChanged();
    setMode("view");
  };

  const doForget = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await attemptWrite(() => svc.unfile(row.id));
    setSaving(false);
    if (!ok) return;
    showToast({ message: "Forgotten ✓" });
    onChanged();
    onClose();
  };

  const doRevisit = async () => {
    if (saving || !revisitText.trim() || !isDecision) return;
    setSaving(true);
    const ok = await attemptWrite(() =>
      // fileMemory builds the §2 payload (LEARNED, today's date, active
      // status); the old row keeps its original date behind the link.
      svc.supersede(row.id, fileMemory({
        category: "decision",
        text: revisitText.trim(),
        why: revisitWhy.trim() || undefined,
        source: "brain",
      })),
    );
    setSaving(false);
    if (!ok) return;
    showToast({ message: filedToastText("decision", svc.pending()) });
    onChanged();
    onClose();
  };

  const doToggleReversed = async () => {
    if (saving || !isDecision) return;
    setSaving(true);
    const ok = await attemptWrite(() =>
      svc.markReversed(row.id, (row.data.status ?? "active") !== "reversed"),
    );
    setSaving(false);
    if (!ok) return;
    onChanged();
  };

  // 2026-10-05 (the catalog gate): the kicker was one string with a middle dot baked in
  // ("Decision · Active") drawn inside ONE .fact (R6). Each is its own fact now and the
  // stylesheet draws the dot.
  const eyebrow = isDecision ? "Decision" : categoryLabel(row.data.category);
  const stateFact = isDecision ? decisionStateLabel(row) : null;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {mode === "forget" ? (
          <>
            <div className="grp"><div className="eyebrow">{eyebrow}</div></div>
            <div className="pad-x sheet-form">
              {/* The exact Forget copy, word for word (Brain Manual v1): the
                  casing laws bow to it. */}
              <div className="strand-head">Forget this?</div>
              <div className="conn-meta">Jarvis will stop using it.</div>
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-secondary btn-block btn-danger-text" disabled={saving}
                onClick={() => void doForget()}>{saving ? "Forgetting..." : "Yes, Forget"}</button>
              <button className="btn btn-secondary btn-block" onClick={() => setMode("view")}>Cancel</button>
            </div>
          </>
        ) : mode === "edit" ? (
          <>
            <div className="grp"><div className="eyebrow">Say It Right</div></div>
            <div className="pad-x sheet-form">
              <div className="field">
                <label className="input-label">The {categoryLabel(category)}</label>
                <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              {isDecision && (
                <div className="field">
                  <label className="input-label">Why This Call</label>
                  <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} />
                </div>
              )}
              <div className="field"><div className="input-label">Where It Belongs</div>
                <div className="chip-row">{CATS.map((c) => (
                  <button key={c} type="button" className={"chip" + (category === c ? " active" : "")}
                    aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel(c)}</button>
                ))}</div>
              </div>
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" disabled={saving || !text.trim()}
                onClick={() => void doEdit()}>{saving ? "Saving..." : "Save"}</button>
              <button className="btn btn-secondary btn-block" onClick={() => setMode("view")}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="grp"><div className="eyebrow"><span>
              <span className="fact">{eyebrow}</span>
              {stateFact && <span className="fact">{stateFact}</span>}
              <span className="fact">Filed From {filedFromLabel(row.data.source)}</span>
            </span></div></div>
            <div className="pad-x sheet-form">
              <div className="strand-head">{row.data.text}</div>
              {row.data.why && <div className="conn-meta">Why: {row.data.why}</div>}
              {/* The day filed is a neutral date, small caps (R8), and a voice sample's length
                  is a number with no state, white: one facts line, not two more greys. */}
              {((row.data.date && formatFiledDate(row.data.date)) || (row.data.wordCount != null && row.data.category === "voice")) && (
                <div className="facts">
                  {row.data.date && <span className="fact date">{formatFiledDate(row.data.date)}</span>}
                  {row.data.wordCount != null && row.data.category === "voice" && <span className="fact"><b>{row.data.wordCount} Words</b></span>}
                </div>
              )}
              {row.data.supersededBy && (
                <div className="conn-meta">Replaced by a Newer Call</div>
              )}
              {row.data.supersedes && (
                <div className="conn-meta">Revisits an Earlier Call</div>
              )}
              {revisiting && (
                <div className="field">
                  <label className="input-label">The New Call</label>
                  <input className="input" value={revisitText}
                    onChange={(e) => setRevisitText(e.target.value)}
                    placeholder="e.g. Switched to Three Mornings a Week" />
                </div>
              )}
              {revisiting && (
                <div className="field">
                  <label className="input-label">Why the Change</label>
                  <input className="input" value={revisitWhy}
                    onChange={(e) => setRevisitWhy(e.target.value)}
                    placeholder="e.g. Evenings Kept Slipping" />
                </div>
              )}
            </div>
            <div className="pad-x sheet-actions">
              {isDecision && !revisiting && (
                <button className="btn btn-secondary btn-block"
                  onClick={() => setRevisiting(true)}>Revisit</button>
              )}
              {isDecision && revisiting && (
                <button className="btn btn-primary btn-block" disabled={saving || !revisitText.trim()}
                  onClick={() => void doRevisit()}>{saving ? "Saving..." : "Save New Call"}</button>
              )}
              {isDecision && !revisiting && (row.data.status ?? "active") !== "archived" && (
                <button className="btn btn-secondary btn-block" disabled={saving}
                  onClick={() => void doToggleReversed()}>
                  {(row.data.status ?? "active") === "reversed" ? "Mark Active" : "Mark Reversed"}
                </button>
              )}
              {!revisiting && (
                <button className="btn btn-secondary btn-block" onClick={() => {
                  setText(row.data.text); setWhy(row.data.why ?? "");
                  setCategory(row.data.category); setMode("edit");
                }}>Edit</button>
              )}
              {!revisiting && (
                <button className="btn btn-secondary btn-block btn-danger-text"
                  onClick={() => setMode("forget")}>Forget</button>
              )}
              {revisiting && (
                <button className="btn btn-secondary btn-block"
                  onClick={() => { setRevisiting(false); setRevisitText(""); setRevisitWhy(""); }}>Cancel</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
