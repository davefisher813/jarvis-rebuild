import { useEffect, useState } from "react";
import { useRoutine } from "../data/NotesProvider";
import { DEFAULT_ROUTINE, isOvernight, isWorkOutsideActive, type RoutineData, type ProtectedBlock } from "./types";
import { fmtTime } from "../schedule/calendar";

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

// --- Protected time (Phase 2) helpers ---
const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 12-hour label for a minutes value, via the shared calendar formatter.
function label12(min: number): string { const t = fmtTime(toHHMM(min)); return `${t.time} ${t.ap}`; }

// Human summary of the selected days: "Every day", "Weekdays", "Weekends", or
// a short list like "Mon Wed Fri".
function daysSummary(days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length === 7) return "Every day";
  if (s.length === 5 && [1, 2, 3, 4, 5].every((d) => s.includes(d))) return "Weekdays";
  if (s.length === 2 && s.includes(0) && s.includes(6)) return "Weekends";
  return s.map((d) => DOW_ABBR[d]).join(" ");
}

interface FormState { id: string | null; label: string; startMin: number; endMin: number; days: number[] }
interface Preset { label: string; startMin: number; endMin: number; days: number[] }
// One-tap starting points. Every field stays editable after a preset is picked.
const PRESETS: Preset[] = [
  { label: "Lunch", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5] },
  { label: "Gym", startMin: 6 * 60, endMin: 7 * 60, days: [1, 3, 5] },
  { label: "Family", startMin: 18 * 60, endMin: 19 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Deep Work", startMin: 9 * 60, endMin: 11 * 60, days: [1, 2, 3, 4, 5] },
];

function pbId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return "pb_" + crypto.randomUUID();
  return "pb_" + Math.random().toString(36).slice(2);
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

  // Protected-time editor state. `form` is the block being added or edited, or
  // null when the list is at rest. Saving a block only patches local `data`:
  // the top Save button persists it, same as every other field here.
  const [form, setForm] = useState<FormState | null>(null);
  const blocks = data.protectedBlocks ?? [];
  const formValid = !!form && form.label.trim() !== "" && form.endMin > form.startMin && form.days.length > 0;

  const openAdd = () => setForm({ id: null, label: "", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5] });
  const openEdit = (b: ProtectedBlock) => setForm({ id: b.id, label: b.label, startMin: b.startMin, endMin: b.endMin, days: [...b.days] });
  const applyPreset = (p: Preset) => setForm((f) => ({ id: f?.id ?? null, label: p.label, startMin: p.startMin, endMin: p.endMin, days: [...p.days] }));
  const toggleDay = (d: number) => setForm((f) => (f ? { ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) } : f));
  const commitForm = () => {
    if (!form || !formValid) return;
    const block: ProtectedBlock = { id: form.id ?? pbId(), label: form.label.trim(), startMin: form.startMin, endMin: form.endMin, days: [...form.days].sort((a, b) => a - b) };
    set({ protectedBlocks: form.id ? blocks.map((b) => (b.id === form.id ? block : b)) : [...blocks, block] });
    setForm(null);
  };
  const removeBlock = (id: string) => set({ protectedBlocks: blocks.filter((b) => b.id !== id) });

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
            <label className="input-label">Wake Up</label>
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
            <label className="input-label">Work Starts</label>
            <input type="time" className="input" value={toHHMM(data.workStartMin)} disabled={!loaded} onChange={(e) => set({ workStartMin: fromHHMM(e.target.value) })} />
          </div>
          <div className="field">
            <label className="input-label">Work Ends</label>
            <input type="time" className="input" value={toHHMM(data.workEndMin)} disabled={!loaded} onChange={(e) => set({ workEndMin: fromHHMM(e.target.value) })} />
          </div>
        </div>
        {workOutside && <div className="input-help">Some work hours fall outside your active hours. That's fine.</div>}

        <div className="grp"><div className="eyebrow">Protected Time</div></div>
        <div className="input-help">Daily blocks JARVIS will never schedule over: gym, meals, family, deep work.</div>

        {blocks.map((b) => (
          <div className="field" key={b.id}>
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={() => openEdit(b)}>
                <div className="row-grow">
                  <div className="conn-name">{b.label}</div>
                  <div className="conn-meta">{label12(b.startMin)} to {label12(b.endMin)} &middot; {daysSummary(b.days)}</div>
                </div>
                <button className="conn-remove" aria-label={`Remove ${b.label}`} onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}>&times;</button>
              </div>
            </div>
          </div>
        ))}

        {form ? (
          <div className="card pad">
            <div className="field">
              <label className="input-label">Quick Add</label>
              <div className="chip-wrap">
                {PRESETS.map((p) => (
                  <div className="chip" role="button" tabIndex={0} key={p.label} onClick={() => applyPreset(p)}>{p.label}</div>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="input-label">Name</label>
              <input className="input" placeholder="Gym, Lunch, Deep work..." value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field"><label className="input-label">From</label><input type="time" className="input" value={toHHMM(form.startMin)} onChange={(e) => setForm({ ...form, startMin: fromHHMM(e.target.value) })} /></div>
              <div className="field"><label className="input-label">To</label><input type="time" className="input" value={toHHMM(form.endMin)} onChange={(e) => setForm({ ...form, endMin: fromHHMM(e.target.value) })} /></div>
            </div>
            {form.endMin <= form.startMin && <div className="input-help">End time needs to be after the start.</div>}
            <div className="field">
              <label className="input-label">Days</label>
              <div className="chip-wrap">
                {DOW_LETTER.map((ltr, d) => (
                  <div className={"chip" + (form.days.includes(d) ? " active" : "")} role="button" tabIndex={0} key={d} aria-pressed={form.days.includes(d)} aria-label={DOW_ABBR[d]} onClick={() => toggleDay(d)}>{ltr}</div>
                ))}
              </div>
            </div>
            <div className="field-row">
              <button className="btn btn-primary btn-block" disabled={!formValid} onClick={commitForm}>{form.id ? "Save Block" : "Add Block"}</button>
              <button className="btn btn-secondary btn-block" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-block" onClick={openAdd}>Add Protected Time</button>
        )}

        <div className="grp"><div className="eyebrow">Weekends</div></div>
        <div className="card">
          <div className="row">
            <div className="row-grow"><div className="conn-name">Different on Weekends</div></div>
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
              <label className="input-label">Weekend Wake</label>
              <input type="time" className="input" value={toHHMM(data.weekendWakeMin ?? data.wakeMin)} disabled={!loaded} onChange={(e) => set({ weekendWakeMin: fromHHMM(e.target.value) })} />
            </div>
            <div className="field">
              <label className="input-label">Weekend Sleep</label>
              <input type="time" className="input" value={toHHMM(data.weekendSleepMin ?? data.sleepMin)} disabled={!loaded} onChange={(e) => set({ weekendSleepMin: fromHHMM(e.target.value) })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
