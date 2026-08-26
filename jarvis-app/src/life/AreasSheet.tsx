import { useState } from "react";
import { createPortal } from "react-dom";
import type { Area, Goal } from "./types";
import { capAfterNumber } from "../shared/casing";

// THE AREAS SHEET (Life View pick 15, 2026-08-25; moved here 2026-08-26 when
// the life layer merged into Your Life). Setup as an invitation, one screen:
// create areas, tap one to assign goals, Keep Alive is the balance choice
// (only chosen areas can ever earn the quiet card), Remove arms first.
// Handlers are passed in already guarded (attemptWrite lives in the flow).

export default function AreasSheet({ areas, goals, onCreate, onToggleChosen, onAssign, onRemove, onClose }: {
  areas: Area[];
  goals: Goal[];
  onCreate: (name: string) => void;
  onToggleChosen: (a: Area) => void;
  onAssign: (goalId: string, areaId: string | null) => void;
  onRemove: (a: Area) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [assigning, setAssigning] = useState<Area | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  if (assigning) {
    return createPortal(
      <div className="sheet-scrim" onClick={() => setAssigning(null)}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle" />
          <div className="grp"><div className="eyebrow">Goals in {assigning.data.name}</div></div>
          <div className="pad-x sheet-form"><div className="card">
            {goals.map((g) => {
              const inArea = g.data.areaId === assigning.id;
              return (
                <div className="row" role="button" tabIndex={0} key={g.id}
                  onClick={() => onAssign(g.id, inArea ? null : assigning.id)}>
                  <div className={"task-check" + (inArea ? " done" : " cat-bd-green")} />
                  <div className="row-grow"><div className="conn-name truncate">{g.data.title}</div></div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <div className="row"><div className="row-grow"><div className="conn-name">No Live Goals Yet</div></div></div>
            )}
          </div></div>
          <div className="pad-x sheet-actions">
            <button className="btn btn-secondary btn-block" onClick={() => setAssigning(null)}>Back</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Your Areas</div></div>
        <div className="pad-x sheet-form">
          <div className="card">
            {areas.map((a) => {
              const n = goals.filter((g) => g.data.areaId === a.id).length;
              return (
              <div className="row" key={a.id}>
                <div className="row-grow" role="button" tabIndex={0} onClick={() => setAssigning(a)}>
                  <div className="conn-name truncate">{a.data.name}</div>
                  <div className="eyebrow">{capAfterNumber(`${n} ${n === 1 ? "goal" : "goals"} · Tap to assign`)}</div>
                </div>
                {/* Keep Alive is the balance choice: only chosen areas can
                    ever earn the quiet card. One tap each way. */}
                <button className="pill-act" onClick={() => onToggleChosen(a)}>{a.data.chosen ? "Kept Alive" : "Keep Alive"}</button>
                <button className="btn-sm btn-danger-text" onClick={() => (armed === a.id ? onRemove(a) : setArmed(a.id))}>{armed === a.id ? "Sure?" : "Remove"}</button>
              </div>
              );
            })}
            {areas.length === 0 && (
              <div className="row"><div className="row-grow">
                <div className="conn-name">No Areas Yet</div>
                <div className="eyebrow">Health, Family, Music · Whatever your life is made of</div>
              </div></div>
            )}
          </div>
          <div className="field field-gap">
            <div className="input-label">New Area</div>
            <input className="input" placeholder="e.g. Health, Family, Music" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={!name.trim()} onClick={() => { onCreate(name.trim()); setName(""); }}>Add Area</button>
          <button className="btn btn-secondary btn-block" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
