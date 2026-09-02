import { createPortal } from "react-dom";
import { useState } from "react";
import type { ColorSlot } from "../../categories/types";
import { suggestFor, loadBlendMemory, blockKind, type Fit } from "../blend";
import type { SheetCategory } from "../../tasks/screens/TaskSheet";
import type { EventRecurrence } from "../types";
import { addMinutes, fmtTime, minToHHMM, addDays } from "../calendar";
import type { TitleSuggestion } from "../memory";
import { DUR_CHOICES, durLabel } from "../durations";
import { catColor } from "../../shared/categories";
import { untilError } from "../repeats";
import SheetBar from "../../shared/SheetBar";
import HeadMenu from "../../shared/HeadMenu";
import { Tile } from "../../shared/FormSheet";
import { Calendar, Tag, Hourglass, Shuffle, Plus } from "../../shared/icons";
import { CalendarGlyph, ClockGlyph, RepeatGlyph, PinGlyph, BarbellGlyph, SunGlyph } from "../../shared/glyphs";

export type { SheetCategory };

// "13:45" -> 825. This file had three inline copies of it.
const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

// Move chips (Dave 2026-08-07: "moving stuff around... feels like work. I want
// it to be something people want to tap"). Adjusting WHEN something happens
// should not mean opening a time picker and dialling. These shift start and
// end together, so length stays the job of the duration chips below and one
// control never quietly does two things.
const NUDGES: [number, string][] = [[-30, "-30m"], [-15, "-15m"], [15, "+15m"], [30, "+30m"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateWord = (iso: string) => { const d = new Date(iso + "T00:00:00"); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export interface EventDraft {
  title: string;
  date: string;
  start: string;
  end: string;
  category: string;
  location: string;
  recurrence: EventRecurrence;
  // N3: the last day the series runs, inclusive. "" means forever, which is
  // what every repeat used to be.
  until?: string;
  taskIds?: string[]; // attached tasks (Session 4 connections)
  // THE TRAINING DOOR (D4-C): this block opens the gym. By the athlete's own
  // hand only -- the sheet never guesses from the title.
  gym?: boolean;
}

// A task the sheet can attach or show attached: open tasks plus any already
// attached (which may be done). Provided by the caller.
export interface AttachableTask {
  id: string;
  text: string;
  category: string;
  done: boolean;
}

// Bottom sheet to create or edit an event. Save calls existing ScheduleService
// methods; presentational + local form state only.
export default function EventSheet({
  mode,
  initial,
  categories,
  checkConflict,
  suggestSlot,
  onSave,
  onDelete,
  onDuplicate,
  onMoveToAnytime,
  onCancel,
  suggestTitles,
  suggestLocations,
  attachTasks,
  onToggleTask,
  onBlend,
}: {
  mode: "new" | "edit";
  initial?: Partial<EventDraft>;
  categories: SheetCategory[];
  checkConflict?: (date: string, start: string, end: string) => boolean;
  suggestSlot?: (date: string) => string;
  onSave: (draft: EventDraft, scope?: "this" | "series") => void;
  onDelete?: (scope?: "this" | "series") => void;
  // E2: copy this event as a new one-off on the same day.
  onDuplicate?: () => void;
  onMoveToAnytime?: () => void;
  onCancel: () => void;
  // Memory layer (Session 3): past events offered whole while typing a title,
  // and locations typed before. Derived by the caller; presentational here.
  suggestTitles?: (typed: string) => TitleSuggestion[];
  suggestLocations?: (title: string) => string[];
  // Connections (Session 4): tasks this event can hold. Checking an attached
  // task completes it everywhere; the caller owns persistence.
  attachTasks?: AttachableTask[];
  onToggleTask?: (id: string) => void;
  // Every blend he actually makes is a vote that this category belongs in
  // this kind of block. The caller persists the vote.
  onBlend?: (kind: ReturnType<typeof blockKind>, categoryId: string) => void;
}) {
  const [taskIds, setTaskIds] = useState<string[]>(initial?.taskIds ?? []);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [start, setStart] = useState(initial?.start ?? "09:00");
  const [end, setEnd] = useState(initial?.end ?? addMinutes(initial?.start ?? "09:00", 60));
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.id ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [recurrence, setRecurrence] = useState<EventRecurrence>(initial?.recurrence ?? "none");
  const [gym, setGym] = useState(!!initial?.gym);
  const [until, setUntil] = useState(initial?.until ?? "");
  const untilBad = recurrence !== "none" ? untilError(date, until) : null;
  const [scope, setScope] = useState<"this" | "series">("series");
  const [err, setErr] = useState(false);

  // Keep end sensible: when start moves past end, push end to start + 1h.
  const onStart = (v: string) => {
    setStart(v);
    if (!end || end <= v) setEnd(addMinutes(v, 60));
    if (err) setErr(false);
  };

  const endInvalid = !!end && end <= start;
  const conflict = checkConflict?.(date, start, end) ?? false;

  const recurringEdit = mode === "edit" && recurrence !== "none";

  const save = () => {
    if (!title.trim() || !date || !start || endInvalid) {
      setErr(true);
      return;
    }
    const draft = { title: title.trim(), date, start, end, category, location: location.trim(), recurrence, until: recurrence === "none" ? "" : until, taskIds: recurrence === "none" ? taskIds : [], gym };
    recurringEdit ? onSave(draft, scope) : onSave(draft);
  };

  // Attachments: only non-recurring events hold tasks (links live on the event
  // and die with it; a whole series sharing one link list is a footgun).
  const canAttach = recurrence === "none" && !!attachTasks;
  const byId = new Map((attachTasks ?? []).map((t) => [t.id, t] as const));
  const attached = canAttach ? taskIds.map((id) => byId.get(id)).filter((t): t is AttachableTask => !!t) : [];
  // BLENDING (2026-08-21). This used to be the first four undone tasks in
  // whatever order the list happened to be in, which is the same as random.
  // Now it is ranked by how well the task fits THIS block, each with the one
  // reason it is being offered, and a task that must not go here (answering
  // email while driving) is not offered at all.
  const blendMem = canAttach ? loadBlendMemory() : {};
  const offers: Fit[] = canAttach
    ? suggestFor({ title, location, category, taskIds }, attachTasks ?? [], blendMem, 4)
    : [];
  // Anything left over, so a deliberate attach is never blocked by the
  // ranking having an opinion.
  const rest = canAttach
    ? (attachTasks ?? [])
      .filter((t) => !t.done && !taskIds.includes(t.id) && !offers.some((o) => o.task.id === t.id))
      .slice(0, 4)
    : [];

  const slot = (c: SheetCategory): ColorSlot => c.color;
  const reps: [EventRecurrence, string][] = [["none", "None"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];

  // Memory: only offer on a new event, and stop once a suggestion was applied
  // or the title exactly matches (nothing left to fill).
  const [memUsed, setMemUsed] = useState(false);
  const titleSugs = mode === "new" && !memUsed && suggestTitles ? suggestTitles(title) : [];
  const locSugs = !location && suggestLocations ? suggestLocations(title) : [];
  const applySug = (s: TitleSuggestion) => {
    setMemUsed(true);
    setTitle(s.title);
    setStart(s.start);
    setEnd(addMinutes(s.start, s.durationMin));
    if (s.location) setLocation(s.location);
    if (categories.some((c) => c.id === s.category)) setCategory(s.category);
    if (err) setErr(false);
  };
  const sugLabel = (s: TitleSuggestion) => {
    const t = fmtTime(s.start);
    const dur = s.durationMin % 60 === 0 ? `${s.durationMin / 60}h` : `${s.durationMin}m`;
    return `${t.time} ${t.ap} · ${dur}`;
  };

  const durNow = end && toMin(end) > toMin(start) ? toMin(end) - toMin(start) : 0;
  const durOptions = DUR_CHOICES.map((m) => ({ value: String(m), label: durLabel(m) }));
  const durValue = DUR_CHOICES.includes(durNow) ? String(durNow) : "custom";
  const durWord = durNow > 0 ? durLabel(durNow) : "None";

  // THE EVENT SHEET ON THE SHEET BAR (the form sheets, 2026-09-02, after the
  // task sheet's picks "The sheet bar and grouped rows" and "A menu drops
  // from the value"). EVENT: the title as the row, with the memory's
  // suggestions as rows under it. WHEN: the date, the start and the end
  // typed at the right of their labels, the length as a value that opens
  // the dropdown, the Move chips as a strip. REPEAT: the repeat and, while
  // it repeats, Until and the date; Apply To on a recurring edit. WHERE:
  // the area and the place. TASKS: what is attached, what fits, and the
  // rest. TRAINING: the door as a switch. The actions are the last group.
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card xs form-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={mode === "new" ? "New Event" : "Edit Event"} onCancel={onCancel} onSave={save} />
        <div className="sheet-form">
          <div className="grp xs-grp"><div className="eyebrow">Event</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="sky"><CalendarGlyph /></Tile>
              <input
                className={"xs-input" + (err && !title.trim() ? " input-error" : "")}
                placeholder="What's happening?"
                aria-label="Event title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); if (err) setErr(false); }}
              />
            </div>
            {/* Memory: past events offered whole while typing, as rows under
                the name, the exercise sheet's library form. */}
            {titleSugs.map((s) => (
              <div key={s.title} className="row xs-row xs-suggest" role="button" tabIndex={0} onClick={() => applySug(s)}>
                <span className={"cat-dot cat-bg-" + catColor(s.category)} />
                <div className="row-grow"><div className="conn-name">{s.title}</div><div className="conn-meta">{sugLabel(s)}</div></div>
              </div>
            ))}
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">When</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="orange"><Calendar className="ic" /></Tile>
              <div className="conn-name">Date</div>
              <input type="date" className={"xs-input xs-field" + (err && !date ? " input-error" : "")} aria-label="Date" value={date}
                onChange={(e) => { setDate(e.target.value); if (err) setErr(false); }} />
            </div>
            <div className="row xs-row">
              <Tile tone="green"><ClockGlyph /></Tile>
              <div className="conn-name">Start</div>
              <input type="time" className="xs-input xs-field" aria-label="Start" value={start} onChange={(e) => onStart(e.target.value)} />
            </div>
            <div className="row xs-row">
              <Tile tone="teal"><ClockGlyph /></Tile>
              <div className="conn-name">End</div>
              <input type="time" className={"xs-input xs-field" + (endInvalid ? " input-error" : "")} aria-label="End" value={end}
                onChange={(e) => { setEnd(e.target.value); if (err) setErr(false); }} />
            </div>
            {/* THE SHARED LIST (2026-08-24): one set of lengths for the day
                row, the plan sheet and this sheet (schedule/durations.ts). */}
            <div className="row xs-row">
              <Tile tone="blue"><Hourglass className="ic" /></Tile>
              <div className="conn-name">Length</div>
              <HeadMenu variant="value" ariaLabel="Length" value={durValue} label={durWord} off={durNow === 0}
                options={durOptions} onPick={(v) => { setEnd(addMinutes(start, Number(v))); if (err) setErr(false); }} />
            </div>
            {/* Move chips (Dave 2026-08-07: "moving stuff around... feels
                like work. I want it to be something people want to tap").
                These shift start and end together, so length stays the
                job of the row above and one control never does two things. */}
            <div className="row xs-strip">
              <div className="chip-row">
                {NUDGES.map(([mins, label]) => {
                  const nextStart = toMin(start) + mins;
                  // Refuse rather than clamp. addMinutes clamps at midnight,
                  // which would pin start or end and silently change the
                  // duration: a "move" control that resizes the event is a
                  // bug, not a nudge.
                  const blocked = nextStart < 0 || nextStart + durNow > 24 * 60 - 1;
                  return (
                    <div
                      key={mins}
                      className={"chip" + (blocked ? " chip-off" : "")}
                      role="button"
                      tabIndex={blocked ? -1 : 0}
                      aria-disabled={blocked}
                      onClick={() => {
                        if (blocked) return;
                        setStart(minToHHMM(nextStart));
                        if (end) setEnd(minToHHMM(nextStart + durNow));
                        if (err) setErr(false);
                      }}
                    >
                      {label}
                    </div>
                  );
                })}
                {date && (
                  <div className="chip" role="button" tabIndex={0} onClick={() => { setDate(addDays(date, 1)); if (err) setErr(false); }}>
                    Tomorrow
                  </div>
                )}
              </div>
            </div>
          </div></div>
          {endInvalid && <div className="input-error xs-error">End must be after start</div>}
          {err && !endInvalid && <div className="input-error xs-error">Needs title · Date · Start</div>}
          {conflict && !endInvalid && (
            <div className="xs-note">
              <span>Overlaps another event</span>
              {suggestSlot && (
                <button type="button" className="note-fix" onClick={() => {
                  const dur = durNow || 60;
                  const next = suggestSlot(date);
                  setStart(next); setEnd(addMinutes(next, dur)); if (err) setErr(false);
                }}>Use Next Free Slot</button>
              )}
            </div>
          )}

          <div className="grp xs-grp"><div className="eyebrow">Repeat</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="purple"><RepeatGlyph /></Tile>
              <div className="conn-name">Repeat</div>
              <HeadMenu variant="value" ariaLabel="Repeat" value={recurrence} off={recurrence === "none"}
                options={reps.map(([val, label]) => ({ value: val, label }))} onPick={(v) => setRecurrence(v as EventRecurrence)} />
            </div>
            {/* N3 (2026-08-21): a repeat can END. Until now every repeating
                event ran forever, so "fall clinics through November" could
                not be said. */}
            {recurrence !== "none" && (
              <div className="row xs-row">
                <Tile tone="indigo"><Calendar className="ic" /></Tile>
                <div className="conn-name">Until</div>
                <HeadMenu variant="value" ariaLabel="Until" value={until === "" ? "forever" : "date"} label={until ? dateWord(until) : undefined} off={until === ""}
                  options={[{ value: "forever", label: "Forever" }, { value: "date", label: "Pick a Date" }]}
                  onPick={(v) => setUntil(v === "forever" ? "" : (until || date))} />
              </div>
            )}
            {recurrence !== "none" && until !== "" && (
              <div className="row xs-row xs-date">
                <input type="date" className="xs-input" aria-label="Until date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
            )}
            {recurringEdit && (
              <div className="row xs-row">
                <Tile tone="graphite"><Shuffle className="ic" /></Tile>
                <div className="conn-name">Apply To</div>
                <HeadMenu variant="value" ariaLabel="Apply to" value={scope}
                  options={[{ value: "this", label: "This Event" }, { value: "series", label: "All Events" }]}
                  onPick={(v) => setScope(v as "this" | "series")} />
              </div>
            )}
          </div></div>
          {untilBad && <div className="input-error xs-error">{untilBad}</div>}

          <div className="grp xs-grp"><div className="eyebrow">Where</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="blue"><Tag className="ic" /></Tile>
              <div className="conn-name">Area</div>
              <HeadMenu variant="value" ariaLabel="Area" value={category}
                options={categories.map((c) => ({ value: c.id, label: c.name, dot: slot(c) as string }))} onPick={setCategory} />
            </div>
            <div className="row xs-row">
              <Tile tone="pink"><PinGlyph /></Tile>
              <div className="conn-name">Place</div>
              <input className="xs-input xs-field" placeholder="Optional" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            {locSugs.map((l) => (
              <div key={l} className="row xs-row xs-suggest" role="button" tabIndex={0} onClick={() => setLocation(l)}>
                <div className="conn-name">{l}</div>
              </div>
            ))}
          </div></div>

          {canAttach && (attached.length > 0 || offers.length > 0 || rest.length > 0) && (
            <>
              <div className="grp xs-grp"><div className="eyebrow">Tasks</div></div>
              <div className="pad-x"><div className="card xs-group">
                {attached.map((t) => (
                  <div className={"row xs-row" + (t.done ? " completed" : "")} key={t.id}>
                    <div
                      className="task-check-tap"
                      role="checkbox"
                      aria-checked={t.done}
                      aria-label={t.done ? "Mark not done" : "Mark done"}
                      onClick={() => onToggleTask?.(t.id)}
                    >
                      <div className={"task-check " + (t.done ? "done" : "cat-bd-" + catColor(t.category))} />
                    </div>
                    <div className="conn-name truncate">{t.text}</div>
                    <button type="button" className="pill-act" onClick={() => setTaskIds((ids) => ids.filter((x) => x !== t.id))}>Detach</button>
                  </div>
                ))}
                {/* BLENDING (2026-08-21): ranked by how well the task fits
                    THIS block, each with the one reason it is offered. One
                    reason, in words. Never a percentage. */}
                {offers.map((o) => (
                  <div key={o.task.id} className="row xs-row" role="button" tabIndex={0}
                    onClick={() => { setTaskIds((ids) => [...ids, o.task.id]); onBlend?.(blockKind({ title, location }), o.task.category); }}>
                    <span className={"cat-dot cat-bg-" + catColor(o.task.category)} />
                    <div className="row-grow">
                      <div className="conn-name truncate">{o.task.text}</div>
                      <div className="conn-meta">{o.why}</div>
                    </div>
                    <span className="pill-act">Add</span>
                  </div>
                ))}
                {rest.length > 0 && (
                  <div className="row xs-strip">
                    <div className="chip-row">
                      {rest.map((t) => (
                        <div key={t.id} className="chip" role="button" tabIndex={0}
                          onClick={() => { setTaskIds((ids) => [...ids, t.id]); onBlend?.(blockKind({ title, location }), t.category); }}>
                          <span className={"cat-dot cat-bg-" + catColor(t.category)} />{t.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div></div>
            </>
          )}

          {/* THE TRAINING DOOR (D4-C). The calendar has no built-in idea of
              which block is the gym, so the athlete says so here, once. */}
          <div className="grp xs-grp"><div className="eyebrow">Training</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="orange"><BarbellGlyph /></Tile>
              <div className="row-grow">
                <div className="conn-name">{gym ? "This Block Opens the Gym" : "Training Door"}</div>
                <div className="conn-meta">{gym ? "Names the day's lift, starts the session, stamps the real minutes" : "Make this block the door to your training"}</div>
              </div>
              <div className={"switch" + (gym ? "" : " off")} role="switch" aria-checked={gym} aria-label="Training door" tabIndex={0}
                onClick={() => setGym((g) => !g)} />
            </div>
          </div></div>

          {mode === "edit" && ((onMoveToAnytime && recurrence === "none") || onDuplicate || onDelete) && (
            <div className="pad-x xs-actions"><div className="card xs-group">
              {onMoveToAnytime && recurrence === "none" && (
                <div className="row xs-row" role="button" tabIndex={0} onClick={onMoveToAnytime}>
                  <Tile tone="sky"><SunGlyph /></Tile>
                  <div className="conn-name">Move to Anytime</div>
                  <div className="chev"></div>
                </div>
              )}
              {/* E2 (2026-08-21): most new events are a near-copy of one
                  that already exists. A copy is always a ONE-OFF. */}
              {onDuplicate && (
                <div className="row xs-row" role="button" tabIndex={0} onClick={onDuplicate}>
                  <Tile tone="indigo"><Plus className="ic" /></Tile>
                  <div className="conn-name">Duplicate</div>
                  <div className="chev"></div>
                </div>
              )}
              {onDelete && (
                <button type="button" className="row xs-row xs-del" onClick={() => (recurringEdit ? onDelete?.(scope) : onDelete?.())}>Delete Event</button>
              )}
            </div></div>
          )}
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
