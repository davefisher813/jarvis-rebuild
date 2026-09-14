import { useState } from "react";
import { createPortal } from "react-dom";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "../gym/muscles";
import { pressable } from "../shared/pressable";
import { capAfterNumber } from "../shared/casing";

// ASSIGN MUSCLES (2026-09-14, item 6). The exercises whose sets the muscle
// breakdown cannot place, each with its set count and a row of muscle
// chips; the first chip picked is the primary, the rest count half. One
// choice can be applied to every exercise listed at once, and each row can
// still differ. Nothing is written until Save; the caller keeps the map it
// replaced and offers Undo.
export default function AssignMusclesSheet({ untagged, current, onSave, onClose }: {
  untagged: { name: string; exerciseKey?: string; sets: number }[];
  /** The map as it stands, keyed by library key (or name for a lift without one). */
  current: Record<string, string[]>;
  onSave: (next: Record<string, string[]>) => void;
  onClose: () => void;
}) {
  const keyOf = (u: { name: string; exerciseKey?: string }) => u.exerciseKey ?? u.name;
  const [draft, setDraft] = useState<Record<string, MuscleGroup[]>>(() => {
    const d: Record<string, MuscleGroup[]> = {};
    for (const u of untagged) d[keyOf(u)] = (current[keyOf(u)] ?? []).filter((m): m is MuscleGroup => (MUSCLE_GROUPS as readonly string[]).includes(m));
    return d;
  });
  const [batch, setBatch] = useState<MuscleGroup[]>([]);
  const toggle = (key: string, m: MuscleGroup) => setDraft((d) => {
    const cur = d[key] ?? [];
    return { ...d, [key]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
  });
  const toggleBatch = (m: MuscleGroup) => setBatch((b) => (b.includes(m) ? b.filter((x) => x !== m) : [...b, m]));
  const applyBatch = () => setDraft((d) => { const n = { ...d }; for (const u of untagged) n[keyOf(u)] = [...batch]; return n; });
  const assigned = untagged.filter((u) => (draft[keyOf(u)] ?? []).length > 0).length;
  const save = () => {
    const next: Record<string, string[]> = { ...current };
    for (const u of untagged) { const list = draft[keyOf(u)] ?? []; if (list.length) next[keyOf(u)] = list; else delete next[keyOf(u)]; }
    onSave(next);
  };
  const chips = (picked: MuscleGroup[], onPick: (m: MuscleGroup) => void, label: string) => (
    <div className="chip-row chip-wrap-row" role="group" aria-label={label}>
      {MUSCLE_GROUPS.map((m) => {
        const at = picked.indexOf(m);
        return (
          <div key={m} {...pressable(() => onPick(m))} className={"chip" + (at >= 0 ? " active" : "")} aria-pressed={at >= 0}>
            {MUSCLE_LABEL[m]}{at === 0 ? " · Primary" : ""}
          </div>
        );
      })}
    </div>
  );
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Assign Muscles</div></div>
        <div className="pad-x sheet-form">
          <div className="facts">
            <span className="fact cyan">{capAfterNumber(`${assigned} of ${untagged.length} assigned`)}</span>
            <span className="fact">The first muscle counts a set whole, the rest half</span>
          </div>
          <div className="field">
            <div className="input-label">Same Muscles for Every Exercise Below</div>
            {chips(batch, toggleBatch, "Muscles for every exercise")}
            <button type="button" className="pill-act pill-quiet" disabled={batch.length === 0} onClick={applyBatch}>Apply to All Listed</button>
          </div>
          {untagged.map((u) => (
            <div className="field" key={keyOf(u)}>
              <div className="row">
                <div className="row-grow"><div className="conn-name">{u.name}</div></div>
                <div className="facts"><span className="fact lime">{`${u.sets} ${u.sets === 1 ? "set" : "sets"}`}</span></div>
              </div>
              {chips(draft[keyOf(u)] ?? [], (m) => toggle(keyOf(u), m), `Muscles for ${u.name}`)}
            </div>
          ))}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={assigned === 0} onClick={save}>Save Muscles</button>
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
