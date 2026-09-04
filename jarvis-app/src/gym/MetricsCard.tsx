import { useState } from "react";
import { createPortal } from "react-dom";
import {
  METRIC_PRESETS, METRIC_TYPE_LABEL, activeMetrics, logOn, formatMetric,
  pulseState, pulsePresets,
  type MetricDef, type MetricLog, type MetricType, type MetricPreset,
} from "./metrics";
import Stepper from "../shared/Stepper";
import { PulseGlyph } from "../shared/glyphs";

const CHEV = <div className="chev" />;
const PULSE_ICO = <PulseGlyph />;

// HEALTH DATA, EVERYONE'S CALL -- D10-B. One tap on the strip logs today;
// the sheet behind "Add a Metric" is also where hide lives (HIDE, NEVER
// DELETE): a preset's switch and a custom metric's switch are the SAME
// control, on the same row shape, because turning one off is never a
// different action from turning the other off.

/** The daily strip: one row per active (on, not hidden) metric, today's
 *  value or "Not logged yet". Tapping a row opens the quick-log sheet. */
export function MetricsCard({ defs, logs, date, onOpen, onManage }: {
  defs: MetricDef[]; logs: MetricLog[]; date: string; onOpen: (def: MetricDef) => void; onManage: () => void;
}) {
  const shown = activeMetrics(defs);
  return (
    <>
      <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-teal">{PULSE_ICO}</div><div className="sec-title">Metrics</div></div><button className="see-all pill-action" onClick={onManage}>Add a Metric</button></div>
      {shown.length === 0 ? (
        <div className="pad-x"><div className="card">
          <div className="row" role="button" tabIndex={0} onClick={onManage}>
            <div className="row-grow"><div className="conn-name">Track Anything You Want</div><div className="conn-meta">Sleep, bodyweight, soreness, or your own</div></div>
            {CHEV}
          </div>
        </div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {shown.map((d) => {
            const log = logOn(logs, d.id, date);
            const val = formatMetric(d.data, log);
            return (
              <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => onOpen(d)}>
                <div className="row-grow"><div className="conn-name">{d.data.name}</div></div>
                <div className={"conn-meta" + (log ? " metric-logged" : "")}>{val}</div>
                {CHEV}
              </div>
            );
          })}
        </div></div>
      )}
    </>
  );
}

/** One metric, one day, one control shaped for its type: a stepper for a
 *  number or minutes, five chips for a 1-5 scale, a switch for yes/no --
 *  never a bare number pad guessing what the type means. */
export function MetricLogSheet({ def, date, initial, onSave, onDelete, onCancel }: {
  def: MetricDef; date: string; initial?: MetricLog;
  onSave: (value: { value?: number; yes?: boolean }) => void;
  /** B3-8 (2026-09-04): the delete this sheet always should have offered.
   *  removeLog existed in the service, tested, with no caller; this sheet had
   *  Save and Cancel only. Only rendered when there is something to delete. */
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [num, setNum] = useState(initial?.data.value ?? 0);
  const [scale, setScale] = useState(initial?.data.value ?? 0);
  const [yes, setYes] = useState(!!initial?.data.yes);
  const step = def.data.type === "minutes" ? 5 : 0.5;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{def.data.name}</div></div>
        <div className="pad-x sheet-form">
          <div className="conn-meta">{date}</div>
          {def.data.type === "yesno" ? (
            <div className="field">
              <div className="row">
                <div className="row-grow"><div className="conn-name">{yes ? "Yes" : "No"}</div></div>
                <div className={"switch" + (yes ? "" : " off")} role="switch" aria-checked={yes} tabIndex={0}
                  onClick={() => setYes((y) => !y)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setYes((y) => !y); }} />
              </div>
            </div>
          ) : def.data.type === "scale5" ? (
            <div className="field">
              <div className="chip-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className={"chip" + (scale === n ? " active" : "")} role="button" tabIndex={0} onClick={() => setScale(n)}>{n}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="field">
              <div className="row">
                <div className="row-grow"><div className="conn-name">{num}{def.data.unit ? ` ${def.data.unit}` : ""}</div></div>
                <Stepper value={num} step={step} min={0} label={def.data.name} onChange={setNum} />
              </div>
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={() => {
            if (def.data.type === "yesno") onSave({ yes });
            else if (def.data.type === "scale5") onSave({ value: scale });
            else onSave({ value: num });
          }}>Save</button>
          {initial && onDelete && (
            <button className="btn btn-danger btn-block" onClick={onDelete}>Delete</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The library, plus a build-your-own field. A preset already on shows its
 *  switch lit; tapping it off HIDES the def (its history stays); tapping an
 *  unstarted preset on creates it. Existing custom metrics get the same
 *  switch, listed below the library under their own name. */
export function AddMetricSheet({ defs, onEnablePreset, onToggleHidden, onCreateCustom, onEnablePulse, onCancel }: {
  defs: MetricDef[];
  onEnablePreset: (preset: MetricPreset) => void;
  onToggleHidden: (def: MetricDef) => void;
  onCreateCustom: (name: string, type: MetricType, unit: string) => void;
  /** Optional: no handler means no pulse row, and the sheet is exactly what
   *  it was. The four are all reachable one at a time from the library below
   *  either way, so this row is a shortcut, never the only door. */
  onEnablePulse?: () => void;
  onCancel: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<MetricType>("number");
  const [unit, setUnit] = useState("");
  const custom = defs.filter((d) => !d.data.presetKey);
  const defFor = (key: string) => defs.find((d) => d.data.presetKey === key);
  // THE DAILY PULSE (handoff item 11). Four presets that are already in the
  // library below, grouped so they come on together. The row disappears once
  // they are all on, rather than sitting there as a dead control; while some
  // are on it offers only the rest, and it never switches anything off.
  const pulse = pulseState(defs);
  const pulseNames = pulsePresets().map((p) => p.name).join(", ");
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Add a Metric</div></div>
        <div className="pad-x sheet-form">
          <div className="input-hint">No targets, no streaks, just your own numbers</div>
          {onEnablePulse && pulse !== "on" && (
            <div className="field">
              <div className="input-label">The Daily Pulse</div>
              <div className="card">
                <div className="row" role="button" tabIndex={0} onClick={onEnablePulse}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onEnablePulse(); }}>
                  <div className="row-grow">
                    <div className="conn-name">{pulse === "partial" ? "Turn On the Rest" : "Turn On All Four"}</div>
                    <div className="conn-meta">{pulseNames}</div>
                  </div>
                  {CHEV}
                </div>
              </div>
            </div>
          )}
          <div className="field">
            <div className="input-label">The Library</div>
            <div className="card">
              {METRIC_PRESETS.map((p) => {
                const d = defFor(p.key);
                const on = !!d && !d.data.hidden;
                return (
                  <div className="row" key={p.key}>
                    <div className="row-grow"><div className="conn-name">{p.name}</div><div className="conn-meta">{METRIC_TYPE_LABEL[p.type]}</div></div>
                    <div className={"switch" + (on ? "" : " off")} role="switch" aria-checked={on} tabIndex={0}
                      onClick={() => (d ? onToggleHidden(d) : onEnablePreset(p))}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") (d ? onToggleHidden(d) : onEnablePreset(p)); }} />
                  </div>
                );
              })}
            </div>
          </div>
          {custom.length > 0 && (
            <div className="field">
              <div className="input-label">Your Own</div>
              <div className="card">
                {custom.map((d) => (
                  <div className="row" key={d.id}>
                    <div className="row-grow"><div className="conn-name">{d.data.name}</div><div className="conn-meta">{METRIC_TYPE_LABEL[d.data.type]}</div></div>
                    <div className={"switch" + (d.data.hidden ? " off" : "")} role="switch" aria-checked={!d.data.hidden} tabIndex={0}
                      onClick={() => onToggleHidden(d)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggleHidden(d); }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!customOpen ? (
            <button className="btn btn-secondary btn-block" onClick={() => setCustomOpen(true)}>Build Your Own</button>
          ) : (
            <div className="field">
              <div className="input-label">Name</div>
              <input className="input" placeholder="e.g. Screen Time" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="segmented field-gap">
                {(["number", "scale5", "yesno", "minutes"] as MetricType[]).map((t) => (
                  <button key={t} className={"seg" + (type === t ? " active" : "")} onClick={() => setType(t)}>{METRIC_TYPE_LABEL[t]}</button>
                ))}
              </div>
              {type === "number" && (
                <input className="input field-gap" placeholder="Unit, e.g. mg" value={unit} onChange={(e) => setUnit(e.target.value)} />
              )}
              <button className="btn btn-primary btn-launch btn-block field-gap" disabled={!name.trim()} onClick={() => {
                onCreateCustom(name.trim(), type, unit.trim());
                setName(""); setUnit(""); setType("number"); setCustomOpen(false);
              }}>Add {name.trim() || "Metric"}</button>
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
