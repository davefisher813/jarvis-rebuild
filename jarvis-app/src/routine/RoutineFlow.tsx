import { useEffect, useState } from "react";
import { useRoutine } from "../data/NotesProvider";
import { DEFAULT_ROUTINE, isOvernight, isWorkOutsideActive, defaultModeFor, freeOf, MODE_LABEL, MODE_HELP, FREE_CHANNELS, type RoutineData, type ProtectedBlock, type BlockKind, type BlockMode, type FreeChannel } from "./types";
import { fmtTime } from "../schedule/calendar";
import { showToast } from "../shared/toast";


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

interface FormState { id: string | null; label: string; startMin: number; endMin: number; days: number[]; kind: BlockKind; soft: boolean; location: string; mode: BlockMode | null; free: FreeChannel[] }
interface Preset { label: string; startMin: number; endMin: number; days: number[]; kind: BlockKind; soft?: boolean }
// One-tap starting points. Every field stays editable after a preset is
// picked. Grown 2026-08-09 (Dave: the routine "does not account for times
// people eat, when they like to work, when they do hobbies"): all three
// meals and a hobby slot, each carrying its kind so the AI knows what the
// time IS, not just that it is taken. Meals and hobbies start flexible;
// gym and family start firm; every one of those is a tap to flip.
const PRESETS: Preset[] = [
  { label: "Breakfast", startMin: 7 * 60 + 30, endMin: 8 * 60, days: [0, 1, 2, 3, 4, 5, 6], kind: "meal", soft: true },
  { label: "Lunch", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5], kind: "meal", soft: true },
  { label: "Dinner", startMin: 18 * 60, endMin: 19 * 60, days: [0, 1, 2, 3, 4, 5, 6], kind: "meal", soft: true },
  { label: "Gym", startMin: 6 * 60, endMin: 7 * 60, days: [1, 3, 5], kind: "gym" },
  { label: "Family", startMin: 18 * 60, endMin: 19 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6], kind: "family" },
  { label: "Deep Work", startMin: 9 * 60, endMin: 11 * 60, days: [1, 2, 3, 4, 5], kind: "focus" },
  { label: "Hobby", startMin: 19 * 60 + 30, endMin: 20 * 60 + 30, days: [2, 4], kind: "hobby", soft: true },
  { label: "Commute", startMin: 8 * 60, endMin: 8 * 60 + 40, days: [1, 2, 3, 4, 5], kind: "commute" },
  { label: "Errands", startMin: 14 * 60, endMin: 16 * 60, days: [6], kind: "errand" },
];

const KINDS: { k: BlockKind; label: string }[] = [
  { k: "meal", label: "Meal" }, { k: "gym", label: "Gym" }, { k: "hobby", label: "Hobby" },
  { k: "family", label: "Family" }, { k: "focus", label: "Focus" }, { k: "errand", label: "Errand" },
  // Commute is the block almost everyone has twice a day and JARVIS could not
  // describe (2026-08-21). It is also, for the Student template, every drive
  // to practice: forty-five minutes where a parent's mouth and ears are free.
  { k: "commute", label: "Commute" }, { k: "work", label: "Work Hours" }, { k: "other", label: "Other" },
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

  const openAdd = () => setForm({ id: null, label: "", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5], kind: "other", soft: false, location: "", mode: null, free: [] });
  const openEdit = (b: ProtectedBlock) => setForm({ id: b.id, label: b.label, startMin: b.startMin, endMin: b.endMin, days: [...b.days], kind: b.kind ?? "other", soft: !!b.soft, location: b.location ?? "", mode: b.mode ?? null, free: b.free ?? [] });
  const applyPreset = (p: Preset) => setForm((f) => ({ id: f?.id ?? null, label: p.label, startMin: p.startMin, endMin: p.endMin, days: [...p.days], kind: p.kind, soft: !!p.soft, location: f?.location ?? "", mode: null, free: [] }));
  const toggleDay = (d: number) => setForm((f) => (f ? { ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) } : f));
  const commitForm = () => {
    if (!form || !formValid) return;
    const block: ProtectedBlock = {
      id: form.id ?? pbId(), label: form.label.trim(), startMin: form.startMin, endMin: form.endMin,
      days: [...form.days].sort((a, b) => a - b), kind: form.kind,
      ...(form.soft ? { soft: true } : {}),
      // Only an EXPLICIT choice is stored. Leaving it alone keeps the block on
      // its kind's default, which is what almost everyone should do.
      ...(form.mode ? { mode: form.mode } : {}),
      ...(form.mode === "blends" && form.free.length ? { free: form.free } : {}),
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
    };
    set({ protectedBlocks: form.id ? blocks.map((b) => (b.id === form.id ? block : b)) : [...blocks, block] });
    setForm(null);
  };
  const removeBlock = (id: string) => set({ protectedBlocks: blocks.filter((b) => b.id !== id) });

  // A failed save must never look like a dead button (audit 2026-07-30): on
  // any failure the user gets told and Save stays live to retry.
  const save = async () => {
    try {
      await routine.save(data);
      setDirty(false);
      setSaved(true);
    } catch {
      showToast({ message: "Couldn't save · Check your connection" });
    }
  };

  // Soft, non-blocking notes. They never turn red, never block Save: they just
  // confirm JARVIS understood an unusual setup. Shown only when relevant.
  const overnight = isOvernight(data);
  const workOutside = isWorkOutsideActive(data);

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Your Routine</div>
        <button className="nav-action-text" onClick={save} disabled={!dirty || !loaded}>{loaded && !dirty ? "Saved" : "Save"}</button>
      </div>

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
        {overnight && <div className="input-help">Overnight · JARVIS plans the day</div>}

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
        {workOutside && <div className="input-help">Work hours outside active hours · Fine</div>}

        <div className="grp"><div className="eyebrow">Protected Time</div></div>

        {blocks.map((b) => (
          <div className="field" key={b.id}>
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={() => openEdit(b)}>
                <div className="row-grow">
                  <div className="conn-name">{b.label}{b.soft ? " · Flexible" : ""}</div>
                  <div className="conn-meta">{label12(b.startMin)} to {label12(b.endMin)} &middot; {daysSummary(b.days)}{b.location ? ` · ${b.location}` : ""}</div>
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
              <input className="input" placeholder="Gym · Lunch · Deep Work" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field"><label className="input-label">From</label><input type="time" className="input" value={toHHMM(form.startMin)} onChange={(e) => setForm({ ...form, startMin: fromHHMM(e.target.value) })} /></div>
              <div className="field"><label className="input-label">To</label><input type="time" className="input" value={toHHMM(form.endMin)} onChange={(e) => setForm({ ...form, endMin: fromHHMM(e.target.value) })} /></div>
            </div>
            {form.endMin <= form.startMin && <div className="input-help">End must be after start</div>}
            <div className="field">
              <label className="input-label">What is it?</label>
              <div className="chip-wrap">
                {KINDS.map(({ k, label: kl }) => (
                  <div className={"chip" + (form.kind === k ? " active" : "")} role="button" tabIndex={0} key={k} aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{kl}</div>
                ))}
              </div>
            </div>
            {/* WHAT HAPPENS IN THIS BLOCK (2026-08-21, Dave: "should be able
                to edit any category like this... some people might be fine
                putting tasks during eating hours"). The default comes from the
                kind, so this only has to be touched by someone who disagrees
                with it. Picking the default back is the same as never having
                chosen: nothing is stored. */}
            {(() => {
              const eff = form.mode ?? defaultModeFor(form.kind, form.label);
              const dflt = defaultModeFor(form.kind, form.label);
              return (
                <div className="field">
                  <label className="input-label">What Happens in This Block</label>
                  <div className="segmented seg-tri">
                    {(["holds", "protects", "blends"] as BlockMode[]).map((m) => (
                      <button
                        type="button"
                        key={m}
                        className={"seg" + (eff === m ? " active" : "")}
                        aria-pressed={eff === m}
                        onClick={() => setForm({ ...form, mode: m === dflt ? null : m })}
                      >{MODE_LABEL[m]}</button>
                    ))}
                  </div>
                  <div className="input-help">{MODE_HELP[eff]}</div>
                  {eff === "blends" && (
                    <>
                      <label className="input-label">What Is Free</label>
                      <div className="chip-wrap">
                        {FREE_CHANNELS.map((c) => {
                          const on = (form.free.length ? form.free : freeOf({ kind: form.kind })).includes(c);
                          return (
                            <div
                              className={"chip" + (on ? " active" : "")}
                              role="button"
                              tabIndex={0}
                              key={c}
                              aria-pressed={on}
                              onClick={() => {
                                const cur = form.free.length ? form.free : freeOf({ kind: form.kind });
                                const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
                                // Never let it reach zero: a block with nothing
                                // free can never receive anything, which is a
                                // dead setting wearing a live control.
                                setForm({ ...form, free: next.length ? next : cur });
                              }}
                            >{c === "mouth" ? "Mouth" : c === "hands" ? "Hands" : "Ears"}</div>
                          );
                        })}
                      </div>
                      <div className="input-help">A call fits · Typing does not</div>
                    </>
                  )}
                </div>
              );
            })()}
            <div className="field">
              <label className="input-label">Where (optional)</label>
              <input className="input" placeholder="Cortland YMCA · home office" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="row">
              <div className="row-grow">
                <div className="conn-name">Flexible</div>
                <div className="conn-meta">Kept clear when possible · Off means never</div>
              </div>
              <button
                className={"switch" + (form.soft ? "" : " off")}
                role="switch"
                aria-checked={form.soft}
                aria-label="Flexible block"
                onClick={() => setForm({ ...form, soft: !form.soft })}
              />
            </div>
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
