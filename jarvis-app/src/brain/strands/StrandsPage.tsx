import { useCallback, useEffect, useState } from "react";
import { useStrands } from "../../data/NotesProvider";
import { todayISO } from "../../ai/useAIContext";
import { haptics } from "../../shared/haptics";
import { showToast } from "../../shared/toast";
import { attemptWrite } from "../../shared/guard";
import {
  STRAND_CATEGORY_LABEL,
  type Strand, type StrandCategory, type StrandEvidence, type DerivationKey,
} from "./types";

// What JARVIS Knows (Brain Layer 2). The genome made visible: every strand,
// its category, where it came from, and its receipts. Wrongness has an exit
// on every row: Edit, Pause, Delete, no burial. Approved preview 2026-08-21;
// lives behind one Brain row so the hub keeps its one flat list (V4 law).

const CATS = Object.keys(STRAND_CATEGORY_LABEL) as StrandCategory[];

const SOURCE_LABEL: Record<string, string> = {
  watched: "Watched", asked: "Asked", told: "Told", uploaded: "Uploaded",
};

function hour12(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12} ${ap}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthDay(iso: string): string {
  const p = iso.split("-");
  const m = MONTHS[Number(p[1]) - 1];
  return m ? `${m} ${Number(p[2])}` : iso;
}

// Receipts render from numbers at display time; the meaning of a/b belongs
// to the derivation (same law as the event log: no free text stored).
export function receiptLine(derivation: DerivationKey | undefined, e: StrandEvidence): string {
  if (derivation === "completion_window" && typeof e.a === "number") {
    return `Finished in the ${hour12(e.a)} window`;
  }
  if (derivation === "slip_category") return "Pushed to a later day";
  if (derivation === "plan_rate" && typeof e.a === "number" && typeof e.b === "number") {
    return `${e.a} of ${e.b} picks done`;
  }
  if (derivation === "task_timing" && typeof e.a === "number") {
    return e.a > 0 ? `Ran ${e.a} min past the estimate` : `Wrapped ${-e.a} min early`;
  }
  return "Seen";
}

export default function StrandsPage({ onBack }: { onBack: () => void }) {
  const svc = useStrands();
  const today = todayISO();
  const [strands, setStrands] = useState<Strand[]>([]);
  const [open, setOpen] = useState<Strand | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [cat, setCat] = useState<StrandCategory>("work_style");

  const reload = useCallback(async () => setStrands(await svc.list()), [svc]);
  useEffect(() => { void reload(); }, [reload]);

  const doAdd = async () => {
    if (!text.trim()) return;
    haptics.success();
    const id = await svc.add(text, cat, today);
    if (!id) showToast({ message: "The Brain is full · Delete one first" });
    else showToast({ message: "JARVIS will remember that" });
    setAdding(false); setText("");
    await reload();
  };

  const doEdit = async () => {
    if (!open || !text.trim()) return;
    haptics.selection();
    await svc.edit(open, text, today);
    setEditing(false); setOpen(null); setText("");
    await reload();
  };

  const doPause = async (s: Strand) => {
    haptics.selection();
    await svc.setStatus(s, s.data.status === "active" ? "paused" : "active");
    setOpen(null);
    await reload();
  };

  // B10/B12 (2026-08-23): the write was unguarded, so a failed delete still
  // said "Forgotten" and closed the row. It is guarded now, and it offers the
  // way back.
  //
  // HONEST ABOUT WHAT UNDO RESTORES: `add` rebuilds the strand's text,
  // category and strength, which is the belief itself. It cannot rebuild the
  // evidence array or the derivation key, because those were observed over
  // time and cannot be re-derived on demand. So JARVIS remembers the thing
  // again but not why it first believed it. That is a real restore of the
  // fact and a partial one of its history, which is the same honest-but-weak
  // shape CategoryDetail already documents for its own undo.
  const doDelete = async (s: Strand) => {
    haptics.selection();
    const kept = s.data;
    const ok = await attemptWrite(() => svc.remove(s));
    if (!ok) return;
    setOpen(null);
    await reload();
    showToast({
      message: "Forgotten",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        await attemptWrite(() => svc.add(kept.text, kept.category, today, kept.strength));
        await reload();
      })(),
    });
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack} aria-label="Back" />
        <span />
      </div>
      <div className="nav-large">What JARVIS Knows</div>

      {strands.length === 0 && (
        <div className="empty-state">
          Nothing yet. JARVIS only writes here what it has watched you do, or what you tell it. Add one thing below, or just live in the app and let it notice.
        </div>
      )}

      {strands.map((s) => (
        <div className="pad-x" key={s.id}>
          <div className="card">
            <div
              className={"row strand-row" + (s.data.status === "paused" ? " paused" : "")}
              role="button"
              tabIndex={0}
              onClick={() => { setOpen(s); setEditing(false); setText(s.data.text); }}
            >
              <div className="row-grow">
                <div className="strand-eyebrow">
                  {STRAND_CATEGORY_LABEL[s.data.category]} &middot; {SOURCE_LABEL[s.data.source] ?? s.data.source}{s.data.status === "paused" ? " · Paused" : ""}
                </div>
                <div className="conn-name">{s.data.text}</div>
              </div>
              <div className="chev" />
            </div>
          </div>
        </div>
      ))}

      <div className="pad-x">
        <button className="row row-act" onClick={() => { setAdding(true); setText(""); }}>Add One Thing</button>
      </div>
      <div className="screen-foot" />

      {open && !editing && (
        <div className="sheet-scrim" onClick={() => setOpen(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">{STRAND_CATEGORY_LABEL[open.data.category]} &middot; {SOURCE_LABEL[open.data.source]}</div></div>
            <div className="pad-x sheet-form">
              <div className="strand-head">{open.data.text}</div>
              <div className="conn-meta">Confirmed {monthDay(open.data.lastConfirmed)}</div>
              {(open.data.evidence ?? []).map((e, i) => (
                <div className="strand-receipt" key={i}>
                  <div className="r-what conn-meta">{receiptLine(open.data.derivation, e)}</div>
                  <div className="conn-meta">{monthDay(e.day)}</div>
                </div>
              ))}
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setEditing(true); setText(open.data.text); }}>Edit</button>
              <button className="btn btn-secondary btn-block" onClick={() => void doPause(open)}>{open.data.status === "active" ? "Pause" : "Resume"}</button>
              <button className="btn btn-secondary btn-block btn-danger-text" onClick={() => void doDelete(open)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {(adding || (open && editing)) && (
        <div className="sheet-scrim" onClick={() => { setAdding(false); setEditing(false); setOpen(null); }}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">{adding ? "One True Thing" : "Say It Right"}</div></div>
            <div className="pad-x sheet-form">
              <div className="field">
                <label className="input-label">{adding ? "Something JARVIS should know about you" : "The fact, in your words"}</label>
                <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Brainstorms best at night" />
              </div>
              {adding && (
                <div className="field"><div className="input-label">Where It Belongs</div>
                  <div className="chip-row">{CATS.map((c) => (
                    <button key={c} className={"chip" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{STRAND_CATEGORY_LABEL[c]}</button>
                  ))}</div>
                </div>
              )}
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" onClick={() => void (adding ? doAdd() : doEdit())}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
