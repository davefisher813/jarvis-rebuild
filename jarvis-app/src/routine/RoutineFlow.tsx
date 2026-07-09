import { useEffect, useState } from "react";
import { useRoutine } from "../data/NotesProvider";
import { DEFAULT_ROUTINE, isOvernight, isWorkOutsideActive, type RoutineData } from "./types";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

// minutes-from-midnight <-> "HH:MM" for native time inputs.
function toHHMM(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function fromHHMM(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}

// Phase 1 routine editor. Active hours (wake/sleep) set the planner's window;
// work hours give the AI context for sequencing. Lives in the Brain tab under
// "How You Live". Editor chrome matches BrainDocPage; fields match EventSheet.
export default function RoutineFlow({ onBack }: { onBack: () => void }) {
  const routine = useRoutine();
  const [data, setData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let on = true;
    routine.get().then((r) => { if (on) { setData(r); setLoaded(true); } });
    return () => { on = false; };
  }, [routine]);

  const set = (patch: Partial<RoutineData>) => {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    await routine.save(data);
    setDirty(false);
    setSaved(true);
  };

  // Soft, non-blocking notes. They never turn red, never block Save: they just
  // confirm JARVIS understood an unusual setup. Shown only when relevant.
  const overnight = isOvernight(data);
  const workOutside = isWorkOutsideActive(data);

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}>{BACK}</button>
        <div className="nav-title">Your Routine</div>
        <button className="nav-action-text" onClick={save} disabled={!dirty || !loaded}>{saved && !dirty ? "Saved" : "Save"}</button>
      </div>

      <div className="sub-bar"><div className="eyebrow">When you're up and when you work. JARVIS plans around it.</div></div>

      <div className="pad-x sheet-form">
        <div className="grp"><div className="eyebrow">Active Hours</div></div>
        <div className="field-row">
          <div className="field">
            <label className="input-label">Wake up</label>
            <input type="time" className="input" value={toHHMM(data.wakeMin)} disabled={!loaded} onChange={(e) => set({ wakeMin: fromHHMM(e.target.value) })} />
          </div>
          <div className="field">
            <label className="input-label">Sleep</label>
            <input type="time" className="input" value={toHHMM(data.sleepMin)} disabled={!loaded} onChange={(e) => set({ sleepMin: fromHHMM(e.target.value) })} />
          </div>
        </div>
        {overnight && <div className="input-help">Overnight schedule. JARVIS plans your daytime hours.</div>}

        <div className="grp"><div className="eyebrow">Work Hours</div></div>
        <div className="field-row">
          <div className="field">
            <label className="input-label">Work starts</label>
            <input type="time" className="input" value={toHHMM(data.workStartMin)} disabled={!loaded} onChange={(e) => set({ workStartMin: fromHHMM(e.target.value) })} />
          </div>
          <div className="field">
            <label className="input-label">Work ends</label>
            <input type="time" className="input" value={toHHMM(data.workEndMin)} disabled={!loaded} onChange={(e) => set({ workEndMin: fromHHMM(e.target.value) })} />
          </div>
        </div>
        {workOutside && <div className="input-help">Some work hours fall outside your active hours. That's fine.</div>}

        <div className="grp"><div className="eyebrow">Weekends</div></div>
        <div className="card">
          <div className="row">
            <div className="row-grow"><div className="conn-name">Different on weekends</div></div>
            <button
              className={"switch" + (data.weekendDifferent ? "" : " off")}
              role="switch"
              aria-checked={!!data.weekendDifferent}
              aria-label="Different hours on weekends"
              disabled={!loaded}
              onClick={() => set({ weekendDifferent: !data.weekendDifferent })}
            />
          </div>
        </div>
        {data.weekendDifferent && (
          <div className="field-row">
            <div className="field">
              <label className="input-label">Weekend wake</label>
              <input type="time" className="input" value={toHHMM(data.weekendWakeMin ?? data.wakeMin)} disabled={!loaded} onChange={(e) => set({ weekendWakeMin: fromHHMM(e.target.value) })} />
            </div>
            <div className="field">
              <label className="input-label">Weekend sleep</label>
              <input type="time" className="input" value={toHHMM(data.weekendSleepMin ?? data.sleepMin)} disabled={!loaded} onChange={(e) => set({ weekendSleepMin: fromHHMM(e.target.value) })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
