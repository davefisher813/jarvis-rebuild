import { createPortal } from "react-dom";
import { useState } from "react";
import type { GoalData } from "../life/types";
import type { MetricMeasure, MetricDirection } from "./metricGoals";
import Stepper from "../shared/Stepper";

// A GOAL ON A READING (Dave's ask 2026-09-12): set from the metric's own log
// sheet, the same way LiftGoalSheet is set from the lift's own screen and
// for the same reason -- this sheet knows the unit and the running history,
// life/GoalSheet.tsx does not, and deliberately carries a metric goal
// through unedited rather than guessing at one (see its own comment). Health
// tags are added HERE, silently, by the caller passing `healthCategoryIds`,
// same as LiftGoalSheet: a metric goal set on a Health-area metric surfaces
// in Bigger Picture under Health with zero new grouping UI.

export default function MetricGoalSheet({
  metricId, metricName, unit, currentValue, initial, healthCategoryIds, onSave, onDelete, onCancel,
}: {
  metricId: string;
  metricName: string;
  unit?: string;
  /** Today's own reading, if there is one -- stamped onto a NEW goal as its
   *  baseline so pct means something from the day it was set. Ignored when
   *  editing: an existing goal keeps the baseline it was created with, the
   *  same rule count's `since` and LiftMeasure's `exercise` follow. */
  currentValue?: number;
  initial?: { title: string; measure?: MetricMeasure; by?: string };
  healthCategoryIds: string[];
  onSave: (data: GoalData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const measureInit = initial?.measure;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [touched, setTouched] = useState(false);
  const [by, setBy] = useState(initial?.by ?? "");
  const [direction, setDirection] = useState<MetricDirection>(measureInit?.direction ?? "down");
  const [target, setTarget] = useState(measureInit?.target ?? (currentValue != null ? Math.round(currentValue) : 0));
  const step = unit === "lb" || unit === "kg" ? 1 : 1;

  const valid = title.trim().length > 0 && target > 0;
  // Double-tapping Save used to create two goals elsewhere in this app (the
  // same GYM-F-20-adjacent bug LiftGoalSheet's own `saving` latch guards);
  // the write here is async too, so the same guard applies.
  const [saving, setSaving] = useState(false);
  // Delete Goal is irreversible from in here, so it arms first, the same
  // two-tap LiftGoalSheet uses.
  const [armDelete, setArmDelete] = useState(false);

  const measureOf = (): MetricMeasure => ({
    kind: "metric",
    metricId,
    metricName,
    ...(unit ? { unit } : {}),
    direction,
    target,
    // Kept exactly as it arrived when only the target or title is being
    // edited (the same rule count's `since` follows for the same reason: an
    // edit is not a fresh start). A brand-new goal stamps today's reading,
    // when there is one, as the baseline pct measures from.
    ...(measureInit ? (measureInit.startValue != null ? { startValue: measureInit.startValue } : {}) : (currentValue != null ? { startValue: currentValue } : {})),
  });

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{initial ? "Edit Goal" : "New Goal"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Goal</div>
            <input className={"input" + (touched && !title.trim() ? " input-error" : "")} placeholder={`e.g. ${metricName} Target`} value={title} onChange={(e) => setTitle(e.target.value)} />
            {touched && !title.trim() && <div className="input-error">Add a goal.</div>}
          </div>
          <div className="field">
            <div className="input-label">Direction</div>
            <div className="segmented">
              <button className={"seg" + (direction === "down" ? " active" : "")} onClick={() => setDirection("down")}>Bring Down</button>
              <button className={"seg" + (direction === "up" ? " active" : "")} onClick={() => setDirection("up")}>Raise Up</button>
            </div>
          </div>
          <div className="field">
            <div className="input-label">Target</div>
            <div className="row"><div className="row-grow"><div className="conn-name">{target}{unit ? ` ${unit}` : ""}</div></div><Stepper value={target} step={step} min={0} label="Target" onChange={setTarget} /></div>
            {touched && !(target > 0) && <div className="input-error">Set a target above zero.</div>}
          </div>
          <div className="field">
            <div className="input-label">Wanted By</div>
            <input type="date" className="input" value={by} onChange={(e) => setBy(e.target.value)} />
            <div className="input-hint">Optional.</div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={saving} onClick={() => {
            if (!valid) { setTouched(true); return; }
            if (saving) return;
            setSaving(true);
            onSave({
              title: title.trim(), state: "on_track",
              ...(healthCategoryIds.length ? { tags: healthCategoryIds } : {}),
              measure: measureOf(),
              by: by || undefined,
            });
          }}>Save</button>
          {onDelete && (
            <button className={"btn btn-block " + (armDelete ? "btn-danger" : "btn-secondary btn-danger-text")}
              onClick={() => (armDelete ? onDelete() : setArmDelete(true))}>
              {armDelete ? "Tap Again to Delete" : "Delete Goal"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
