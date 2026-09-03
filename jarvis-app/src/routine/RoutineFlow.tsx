import { useEffect, useRef, useState } from "react";
import { useRoutine } from "../data/NotesProvider";
import { DEFAULT_ROUTINE, isOvernight, isWorkOutsideActive, defaultModeFor, freeOf, MODE_LABEL, MODE_HELP, FREE_CHANNELS, type RoutineData, type ProtectedBlock, type BlockKind, type BlockMode, type FreeChannel } from "./types";
import { fmtTime } from "../schedule/calendar";
import { showToast } from "../shared/toast";
import PageHeader from "../shared/PageHeader";
import { Head, Card, Row, Switch, Foot } from "../settings/kit";
import { FormSheet, Group, FieldRow, Strip, Note, ErrorLine, DeleteRow } from "../shared/FormSheet";


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
// "How You Live". Protected Time blocks are added and edited on the form
// sheet, same as any other record; only the top Save persists the whole
// routine, blocks included.
export default function RoutineFlow({ onBack, focusId, onFocusConsumed }: { onBack: () => void; focusId?: string; onFocusConsumed?: () => void }) {
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

  // Protected-time editor state. `form` is the block being added or edited on
  // the sheet, or null when it is closed. Saving a block only patches local
  // `data`: the top Save button persists it, same as every other field here.
  const [form, setForm] = useState<FormState | null>(null);
  const blocks = data.protectedBlocks ?? [];
  // Shown in time order (2026-08-28): the stored array is insertion order,
  // which turns into a shuffled list the moment two blocks are added out of
  // sequence. A day-shaped list reads at a glance; an insertion-order one
  // makes you check every row's time to find the one you came for.
  const sortedBlocks = [...blocks].sort((a, b) => a.startMin - b.startMin);
  const formValid = !!form && form.label.trim() !== "" && form.endMin > form.startMin && form.days.length > 0;

  const openAdd = () => setForm({ id: null, label: "", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5], kind: "other", soft: false, location: "", mode: null, free: [] });
  const openEdit = (b: ProtectedBlock) => setForm({ id: b.id, label: b.label, startMin: b.startMin, endMin: b.endMin, days: [...b.days], kind: b.kind ?? "other", soft: !!b.soft, location: b.location ?? "", mode: b.mode ?? null, free: b.free ?? [] });
  // Landing straight in the block someone tapped (2026-08-28). A tap on a
  // protected block anywhere else in the app hands its id here; once the
  // routine has loaded, that block's own sheet opens itself instead of
  // making the person scroll the whole list to find it again. One-shot: the
  // ref guards against reopening if they close the sheet and the id is still
  // sitting in props.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !focusId || focusedRef.current) return;
    const b = blocks.find((x) => x.id === focusId);
    if (!b) return;
    focusedRef.current = true;
    openEdit(b);
    // One-shot: tell the parent this id has done its job, so a later visit
    // to Routine that does not come from tapping a block (the hub row, a
    // second look at the whole list) opens on the list, not back on Gym.
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, focusId, blocks]);
  const applyPreset = (p: Preset) => setForm((f) => ({ id: f?.id ?? null, label: p.label, startMin: p.startMin, endMin: p.endMin, days: [...p.days], kind: p.kind, soft: !!p.soft, location: f?.location ?? "", mode: null, free: [] }));
  const toggleDay = (d: number) => setForm((f) => (f ? { ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) } : f));
  // Shared by Save and Duplicate: the block the current form describes,
  // wearing whichever id it is given.
  const blockFromForm = (f: FormState, id: string): ProtectedBlock => ({
    id, label: f.label.trim(), startMin: f.startMin, endMin: f.endMin,
    days: [...f.days].sort((a, b) => a - b), kind: f.kind,
    ...(f.soft ? { soft: true } : {}),
    // Only an EXPLICIT choice is stored. Leaving it alone keeps the block on
    // its kind's default, which is what almost everyone should do.
    ...(f.mode ? { mode: f.mode } : {}),
    ...(f.mode === "blends" && f.free.length ? { free: f.free } : {}),
    ...(f.location.trim() ? { location: f.location.trim() } : {}),
  });
  const commitForm = () => {
    if (!form || !formValid) return;
    const block = blockFromForm(form, form.id ?? pbId());
    set({ protectedBlocks: form.id ? blocks.map((b) => (b.id === form.id ? block : b)) : [...blocks, block] });
    setForm(null);
  };
  // Duplicate (2026-08-28, Dave: "seamlessly adjust things on the fly"). Two
  // variants of one block - Gym at 6 AM Mon/Wed/Fri and a different Gym at 8
  // AM Saturday - used to mean typing the whole thing twice. This clones
  // whatever the form currently says (so a tweak made before duplicating
  // rides along) as a NEW block and leaves the original exactly as it was.
  const duplicateForm = () => {
    if (!form || !formValid) return;
    const block = blockFromForm(form, pbId());
    set({ protectedBlocks: [...blocks, block] });
    setForm(null);
    showToast({ message: `Duplicated ${block.label}` });
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
    <div className="screen ruled">
      <PageHeader
        title="Your Routine"
        back="Brain"
        onBack={onBack}
        actions={<button className="nav-action-text" onClick={() => void save()} disabled={!dirty || !loaded}>{loaded && !dirty ? "Saved" : "Save"}</button>}
      />

      <Head label="Active Hours" />
      <Card>
        <Row label="Wake Up"><input type="time" className="set-field" aria-label="Wake up" value={toHHMM(data.wakeMin)} disabled={!loaded} onChange={(e) => set({ wakeMin: fromHHMM(e.target.value) })} /></Row>
        <Row label="Sleep"><input type="time" className="set-field" aria-label="Sleep" value={toHHMM(data.sleepMin)} disabled={!loaded} onChange={(e) => set({ sleepMin: fromHHMM(e.target.value) })} /></Row>
      </Card>
      {overnight && <Foot>Overnight · JARVIS plans the day</Foot>}

      <Head label="Work Hours" />
      <Card>
        <Row label="Work Starts"><input type="time" className="set-field" aria-label="Work starts" value={toHHMM(data.workStartMin)} disabled={!loaded} onChange={(e) => set({ workStartMin: fromHHMM(e.target.value) })} /></Row>
        <Row label="Work Ends"><input type="time" className="set-field" aria-label="Work ends" value={toHHMM(data.workEndMin)} disabled={!loaded} onChange={(e) => set({ workEndMin: fromHHMM(e.target.value) })} /></Row>
      </Card>
      {workOutside && <Foot>Work hours outside active hours · Fine</Foot>}

      <Head label="Protected Time" />
      <Card>
        {sortedBlocks.map((b) => (
          <Row
            key={b.id}
            label={b.label + (b.soft ? " · Flexible" : "")}
            meta={`${label12(b.startMin)} to ${label12(b.endMin)} · ${daysSummary(b.days)}${b.location ? ` · ${b.location}` : ""}`}
            onClick={() => openEdit(b)}
            chev
          />
        ))}
        <button type="button" className="row row-act" onClick={openAdd}>Add Protected Time</button>
      </Card>

      <Head label="Weekends" />
      <Card>
        <Switch label="Different on Weekends" on={!!data.weekendDifferent} onToggle={() => set({ weekendDifferent: !data.weekendDifferent })} ariaLabel="Different hours on weekends" />
        {data.weekendDifferent && (
          <>
            <Row label="Weekend Wake"><input type="time" className="set-field" aria-label="Weekend wake" value={toHHMM(data.weekendWakeMin ?? data.wakeMin)} disabled={!loaded} onChange={(e) => set({ weekendWakeMin: fromHHMM(e.target.value) })} /></Row>
            <Row label="Weekend Sleep"><input type="time" className="set-field" aria-label="Weekend sleep" value={toHHMM(data.weekendSleepMin ?? data.sleepMin)} disabled={!loaded} onChange={(e) => set({ weekendSleepMin: fromHHMM(e.target.value) })} /></Row>
          </>
        )}
      </Card>

      <div className="screen-foot" />

      {form && (() => {
        const eff = form.mode ?? defaultModeFor(form.kind, form.label);
        const dflt = defaultModeFor(form.kind, form.label);
        return (
          <FormSheet
            title={form.id ? "Edit Block" : "New Block"}
            onCancel={() => setForm(null)}
            onSave={commitForm}
            saveDisabled={!formValid}
            saveLabel={form.id ? "Save Block" : "Add Block"}
          >
            {!form.id && (
              <Group label="Quick Add">
                <Strip>
                  {PRESETS.map((p) => (
                    <div className="chip" role="button" tabIndex={0} key={p.label} onClick={() => applyPreset(p)}>{p.label}</div>
                  ))}
                </Strip>
              </Group>
            )}
            <Group label="Name">
              <FieldRow ariaLabel="Name" placeholder="Gym · Lunch · Deep Work" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
            </Group>
            <Group label="When">
              <FieldRow label="From" type="time" ariaLabel="Start time" value={toHHMM(form.startMin)} onChange={(v) => setForm({ ...form, startMin: fromHHMM(v) })} />
              <FieldRow label="To" type="time" ariaLabel="End time" value={toHHMM(form.endMin)} onChange={(v) => setForm({ ...form, endMin: fromHHMM(v) })} />
            </Group>
            <ErrorLine text={form.endMin <= form.startMin ? "End must be after start" : null} />

            <Group label="What Is It">
              <Strip>
                {KINDS.map(({ k, label: kl }) => (
                  <div className={"chip" + (form.kind === k ? " active" : "")} role="button" tabIndex={0} key={k} aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{kl}</div>
                ))}
              </Strip>
            </Group>

            {/* WHAT HAPPENS IN THIS BLOCK (2026-08-21, Dave: "should be able
                to edit any category like this... some people might be fine
                putting tasks during eating hours"). The default comes from the
                kind, so this only has to be touched by someone who disagrees
                with it. Picking the default back is the same as never having
                chosen: nothing is stored. */}
            <Group label="What Happens in This Block">
              <Strip>
                {(["holds", "protects", "blends"] as BlockMode[]).map((m) => (
                  <div
                    className={"chip" + (eff === m ? " active" : "")}
                    role="button"
                    tabIndex={0}
                    key={m}
                    aria-pressed={eff === m}
                    onClick={() => setForm({ ...form, mode: m === dflt ? null : m })}
                  >{MODE_LABEL[m]}</div>
                ))}
              </Strip>
              <Note>{MODE_HELP[eff]}</Note>
              {eff === "blends" && (
                <>
                  <Strip>
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
                  </Strip>
                  <Note>A call fits · Typing does not</Note>
                </>
              )}
            </Group>

            <Group label="Where">
              <FieldRow ariaLabel="Location" placeholder="Cortland YMCA · home office (optional)" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
            </Group>

            <Group label="Flexible">
              <div className="row xs-row">
                <div className="conn-name">Kept Clear When Possible</div>
                <div
                  className={"switch" + (form.soft ? "" : " off")}
                  role="switch"
                  aria-checked={form.soft}
                  aria-label="Flexible block"
                  tabIndex={0}
                  onClick={() => setForm({ ...form, soft: !form.soft })}
                  onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setForm({ ...form, soft: !form.soft }); } }}
                />
              </div>
              <Note>Off means never</Note>
            </Group>

            <Group label="Days">
              <Strip>
                {DOW_LETTER.map((ltr, d) => (
                  <div className={"chip" + (form.days.includes(d) ? " active" : "")} role="button" tabIndex={0} key={d} aria-pressed={form.days.includes(d)} aria-label={DOW_ABBR[d]} onClick={() => toggleDay(d)}>{ltr}</div>
                ))}
              </Strip>
            </Group>

            {form.id && (
              <>
                <button type="button" className="btn btn-tertiary btn-block" disabled={!formValid} onClick={duplicateForm}>Duplicate as New Block</button>
                <DeleteRow label="Delete Block" onClick={() => { removeBlock(form.id!); setForm(null); }} />
              </>
            )}
          </FormSheet>
        );
      })()}
    </div>
  );
}
