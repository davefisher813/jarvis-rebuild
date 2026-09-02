import { createPortal } from "react-dom";
import { useState } from "react";
import type { GoalData } from "./types";
import type { Category } from "../categories/types";
import type { Measure, Cadence } from "../bigger/measure";
import { todayISO } from "../tasks/grouping";

type MeasureKind = "none" | "count" | "cadence" | "projects";
const KINDS: { key: MeasureKind; label: string }[] = [
  { key: "none", label: "None" },
  { key: "count", label: "Count" },
  { key: "cadence", label: "Rhythm" },
  { key: "projects", label: "Projects" },
];

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

// A goal is just a name plus the projects pointing at it. Session 6 removed
// BOTH self-reported controls that used to live here:
//   - Area: Life Areas were retired (state nobody maintained).
//   - Status: progress is now DERIVED from the goal's projects and their tasks,
//     so asking the user to also declare "on track" was a decision that changed
//     nothing they would ever see.
// Stored values for both are preserved on save rather than destroyed.
//
// ARCHITECTURE C (2026-08-22): plus the areas it covers. This is the one field
// that lets a goal see work nobody filed, which in Dave's data is nearly all of
// it. It is a WATCH LIST, not a move: nothing is refiled, nothing is copied,
// and unpicking an area changes only what the goal can see.
export default function GoalSheet({ mode, initial, categories = [], onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: GoalData; categories?: Category[];
  onSave: (d: GoalData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  // THE SHORT NAME (2026-09-01, "Fewer Words"): what task rows print after
  // the goal mark. Empty means "use the two-word default", shown as the
  // placeholder so he can see what the rows will say before typing.
  // Money v1: an optional dollar target turns this into a savings goal.
  // Progress stays DERIVED (from logged entries), so this is a target, not a
  // self-reported status; it earns its field.
  const [target, setTarget] = useState(initial?.moneyTarget ? String(initial.moneyTarget) : "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  // D12 (2026-08-31): a lift or training measure is set FROM THE GYM (its
  // own sheet knows how to pick an exercise and a target set; this one does
  // not). This sheet neither edits nor destroys one: it is carried through
  // on save exactly as it arrived, and the segmented picker below reads
  // "None" for it rather than pretending the goal has no finish line.
  const externalMeasure = initial?.measure?.kind === "lift" || initial?.measure?.kind === "training" ? initial.measure : undefined;
  // PICKS 13 + 14: the finish line and the date. Both optional, both derived
  // once set: nothing here asks him to report a status, only to say what
  // "done" means and when he wants it.
  const initialKind: MeasureKind =
    initial?.measure?.kind === "count" || initial?.measure?.kind === "cadence" || initial?.measure?.kind === "projects"
      ? initial.measure.kind : "none";
  const [kind, setKind] = useState<MeasureKind>(initialKind);
  const [count, setCount] = useState(initial?.measure?.kind === "count" ? String(initial.measure.target) : "");
  const [times, setTimes] = useState(initial?.measure?.kind === "cadence" ? String(initial.measure.times) : "3");
  const [per, setPer] = useState<Cadence>(initial?.measure?.kind === "cadence" ? initial.measure.per : "week");
  const [by, setBy] = useState(initial?.by ?? "");
  const [touched, setTouched] = useState(false);
  const targetOk = target.trim() === "" || (Number.isFinite(Number(target)) && Number(target) > 0);
  const countOk = kind !== "count" || (Number.isFinite(Number(count)) && Number(count) > 0);
  const timesOk = kind !== "cadence" || (Number.isFinite(Number(times)) && Number(times) > 0);
  const valid = title.trim().length > 0 && targetOk && countOk && timesOk;
  const measureOf = (): Measure | undefined => {
    if (kind === "count") return {
      kind: "count", target: Number(count),
      // Stamped so a count NEVER inherits the tagged history behind it. Kept
      // when the target is only edited, so editing does not reset progress.
      since: initial?.measure?.kind === "count" ? initial.measure.since ?? todayISO() : todayISO(),
    };
    if (kind === "cadence") return { kind: "cadence", times: Number(times), per };
    if (kind === "projects") return { kind: "projects" };
    return externalMeasure; // "None" here means "untouched", not "cleared", when a gym goal owns it
  };
  const toggleTag = (id: string) => setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Goal" : "Edit Goal"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Goal</div>
            <input className={"input" + (touched && !title.trim() ? " input-error" : "")} placeholder="e.g. Run a half marathon" value={title} onChange={(e) => setTitle(e.target.value)} />
            {touched && !title.trim() && <div className="input-error">Add a goal.</div>}
          </div>
          {categories.length > 0 && (
            <div className="field">
              <div className="input-label">Areas It Covers</div>
              <div className="chip-row">
                {categories.map((c) => (
                  <button key={c.id} className={"chip" + (tags.includes(c.id) ? " active" : "")} onClick={() => toggleTag(c.id)}>{c.data.name}</button>
                ))}
              </div>
              <div className="input-hint">Tasks in these areas count toward this goal without being filed under a project.</div>
            </div>
          )}
          <div className="field">
            <div className="input-label">Finish Line</div>
            <div className="segmented">
              {KINDS.map((k) => (
                <button key={k.key} className={"seg" + (kind === k.key ? " active" : "")} onClick={() => setKind(k.key)}>{k.label}</button>
              ))}
            </div>
            {kind === "count" && (
              <input className={"input field-gap" + (touched && !countOk ? " input-error" : "")} inputMode="numeric" placeholder="How many, e.g. 12" value={count} onChange={(e) => setCount(e.target.value)} />
            )}
            {kind === "cadence" && (
              <>
                <input className={"input field-gap" + (touched && !timesOk ? " input-error" : "")} inputMode="numeric" placeholder="How many times, e.g. 3" value={times} onChange={(e) => setTimes(e.target.value)} />
                <div className="segmented field-gap">
                  {(["week", "month"] as Cadence[]).map((p) => (
                    <button key={p} className={"seg" + (per === p ? " active" : "")} onClick={() => setPer(p)}>{p === "week" ? "A Week" : "A Month"}</button>
                  ))}
                </div>
              </>
            )}
            <div className="input-hint">
              {externalMeasure
                ? "Set from the gym · Picking one of these replaces it"
                : "What finished looks like · Progress counted from real completions, never typed in"}
            </div>
          </div>
          {(kind !== "none" || externalMeasure) && (
            <div className="field">
              <div className="input-label">Wanted By</div>
              <input type="date" className="input" value={by} onChange={(e) => setBy(e.target.value)} />
              <div className="input-hint">Optional. With a finish line, a date becomes a rate you can check against.</div>
            </div>
          )}
          <div className="field">
            <div className="input-label">Dollar Target</div>
            <input className={"input" + (touched && !targetOk ? " input-error" : "")} inputMode="numeric" placeholder="Optional, e.g. 2000" value={target} onChange={(e) => setTarget(e.target.value)} />
            {touched && !targetOk && <div className="input-error">A number, or empty</div>}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ title: title.trim(), state: initial?.state ?? "on_track", ...(initial?.areaId ? { areaId: initial.areaId } : {}), ...(initial?.saved ? { saved: initial.saved } : {}), ...(initial?.dropped ? { dropped: initial.dropped } : {}), ...(tags.length ? { tags } : {}), measure: measureOf(), by: (kind !== "none" || externalMeasure) && by ? by : undefined, moneyTarget: target.trim() ? Number(target) : undefined }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>{TRASH}Delete Goal</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
