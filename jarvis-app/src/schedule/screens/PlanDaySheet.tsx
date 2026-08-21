import { createPortal } from "react-dom";
import { useMemo, useState } from "react";
import type { EventItem } from "../types";
import { planDay, type PlanBlock } from "../planDay";
import { fmtTime } from "../calendar";
import { catColor } from "../../shared/categories";
import { FULL_DAY, type DaySizing } from "../daySizing";
import { emit, eventLog } from "../../events";
import { recordPicks, planRecord } from "../../events/planOutcome";
import { learnedDurations, readCommittedDurations } from "../learnedDurations";
import PlanStrip from "./PlanStrip";
import { todayISO } from "../../tasks/grouping";
import { splitProtectedRanges, type BlockKind } from "../../routine/types";
import { openMinutes, loadOf, loadLine, dropToFit, dropLine, hhmm, autoSelect } from "../planLoad";
import { capOffer } from "../planCap";
import { splitSittings, splitLine, SITTING_MAX } from "../splitSitting";
import { pickByFeel, feelAvailable, FEEL_LABEL, type Feel } from "../pickByFeel";
import { dayClock } from "../planClock";
import { capAfterNumber } from "../../shared/casing";
import { loadShapes, dayScores, planCount, shapeOffer, applyShape, saveShape } from "../dayShape";
import { estimateFor, padNote, learnedNote } from "../padding";

const BUFFER = 10;
const DEFAULT_DUR = 45;
const DUR_MIN = 15;
const DUR_MAX = 240;
// P6 (Dave 2026-08-20): 45m to 2h was five taps on a stepper. Chips do it in
// one. The set is the lengths real work actually comes in.
const DUR_CHOICES = [15, 30, 45, 60, 90, 120];

// A protected range shown in the plan: gym, meals, deep work. Fed to the planner
// as busy time so proposed blocks route around it. Phase 2.
// soft (2026-08-09): rides in from the routine's hard/soft split. Hard blocks
// are walls the auto-placer routes around; soft ones are preferences it uses
// only when the day is tight, and the sheet says so per pick.
// kind (2026-08-10): focus blocks flip the whole relationship: they are time
// set aside FOR tasks, so picks land inside them first instead of around them.
export interface PlanBlocked { s: number; e: number; label: string; soft?: boolean; kind?: BlockKind }
// goal (6.7): the goal this task moves, shown under the name so picking a
// task is also picking what it advances. windowS/E: work-hours placement.
export interface PlanCandidate { id: string; text: string; category: string; suggested: boolean; overdue: boolean; goal?: string | null; windowS?: number; windowE?: number; due?: string }

function fromMin(t: number) {
  const m = Math.max(0, Math.min(24 * 60 - 1, t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(hhmmStr: string): number {
  const p = hhmmStr.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}
function label(hhmmStr: string) { const t = fmtTime(hhmmStr); return `${t.time} ${t.ap}`; }
// A pick split into sittings carries a synthetic id, "<taskId>#2". Everything
// downstream of the planner speaks the real id again.
const realId = (id: string) => id.split("#")[0] ?? id;

// Plan My Day, rebuilt 2026-08-20. Dave, on a screenshot: "look at how limited
// this still is." He was right, and three things in it were plainly broken:
// the sheet never said WHICH day it was planning (so Plan Tomorrow offered
// tomorrow's 1 PM at 10:54 PM tonight and read as a bug), three of five
// routine rows existed only to say when he eats, and the task list silently
// drops anything already scheduled, so a planned day looked like an empty one.
//
// Beyond the fixes, the sheet stopped making him do the planner's job:
// "Plan It For Me" picks, sizes, orders and places the whole day in one tap,
// and every number it was already computing in silence (open time, over-run,
// his real finish rate, his peak hours) now says itself out loud.
export default function PlanDaySheet({
  events,
  tasks,
  startMin,
  endMin,
  date,
  dayLabel,
  target = "today",
  onTarget,
  alreadyPlanned = [],
  routineConfigured = true,
  blocked = [],
  sizing = FULL_DAY,
  peak,
  onEditRoutine,
  onAddTask,
  onProtect,
  onCommit,
  onClose,
  onAIPlan,
}: {
  events: EventItem[];
  tasks: PlanCandidate[];
  startMin: number;
  endMin: number;
  // B1 (2026-08-20): the sheet is told which day it is filling, and says so.
  // Every input already flipped for tomorrow; only the words did not.
  date: string;
  dayLabel: string;
  target?: "today" | "tomorrow";
  onTarget?: (t: "today" | "tomorrow") => void;
  // B3: what is ALREADY on this day from a previous plan. The list drops
  // these (correctly, they are placed) and used to say nothing about them.
  alreadyPlanned?: string[];
  routineConfigured?: boolean;
  blocked?: PlanBlocked[];
  sizing?: DaySizing;
  // P5: the peak window the planner has always quietly used. Silent
  // intelligence reads as no intelligence.
  peak?: { s: number; e: number };
  onEditRoutine?: () => void;
  // P7: make a task without leaving the sheet.
  onAddTask?: (text: string) => Promise<PlanCandidate | null>;
  // P15: protect time from here instead of going to Routine and losing your place.
  onProtect?: (label: string, startMin: number, endMin: number) => Promise<boolean>;
  onCommit: (blocks: PlanBlock[]) => void;
  onClose: () => void;
  onAIPlan?: (picks: { id: string; text: string; category: string; overdue: boolean }[], startMin: number, endMin: number) => Promise<{ items: { id: string; minutes: number }[]; leanedOn: string[] }>;
}) {
  const [extra, setExtra] = useState<PlanCandidate[]>([]);
  const allTasks = useMemo(() => [...extra, ...tasks], [extra, tasks]);

  // Pre-pick the top suggested tasks: capped on a light day (sizing.maxBlocks),
  // otherwise just a sane starter set; picking more is always available.
  const [picks, setPicks] = useState<string[]>(() => {
    const suggested = tasks.filter((t) => t.suggested).map((t) => t.id);
    const seedCap = sizing.maxBlocks ?? 3;
    return suggested.slice(0, seedCap);
  });
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // P13: how many sittings a pick is broken into. 1 unless he says otherwise.
  const [sittings, setSittings] = useState<Record<string, number>>({});
  // P11: a one-day end time. The routine's window is the default, not a cage.
  const [doneBy, setDoneBy] = useState<string>("");
  // P4: the finish-rate offer, once taken, caps the picks like a light day.
  const [capTaken, setCapTaken] = useState<number | null>(null);
  // P1: true once a one-tap plan has been generated and is waiting on Accept.
  const [autoPlanned, setAutoPlanned] = useState(false);
  const [expandRoutine, setExpandRoutine] = useState(false);
  const [adding, setAdding] = useState("");
  const [protecting, setProtecting] = useState<{ label: string; s: string; e: string } | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const effEnd = doneBy ? Math.min(endMin, toMin(doneBy)) : endMin;
  const effCap = capTaken ?? sizing.maxBlocks;

  const learned = useMemo(() => learnedDurations(readCommittedDurations(), Date.now()), []);
  const log = useMemo(() => eventLog.all(), []);
  const record = useMemo(() => planRecord(log, Date.now()), [log]);
  const cap = useMemo(() => capOffer(record, planCount(log)), [record, log]);
  const shape = useMemo(
    () => shapeOffer(loadShapes(), new Date(date + "T12:00:00").getDay(), date, dayScores(log)),
    [date, log],
  );
  const clock = target === "today" ? dayClock(startMin, effEnd) : null;

  const catOf = (id: string) => allTasks.find((t) => t.id === realId(id))?.category ?? "";
  // B3 (2026-08-20): an unlearned category gets a PADDED default, because a
  // flat default is exactly where the underestimate lives. A measurement
  // always beats a pad, and the pad is labelled so it is never mistaken for
  // one. An explicit stepper edit still wins over both.
  const estFor = (id: string) => estimateFor(catOf(id), learned, DEFAULT_DUR, DUR_CHOICES);
  const durFor = (id: string) => durations[id] ?? estFor(id).minutes;
  const setDur = (id: string, next: number) => setDurations((prev) => ({ ...prev, [id]: Math.max(DUR_MIN, Math.min(DUR_MAX, next)) }));
  const setOverride = (id: string, hhmmStr: string) => setOverrides((prev) => {
    if (!hhmmStr) { const n = { ...prev }; delete n[id]; return n; }
    return { ...prev, [id]: hhmmStr };
  });
  const clearOverride = (id: string) => setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [aiEstimates, setAiEstimates] = useState<Record<string, number>>({});
  const [leanedOn, setLeanedOn] = useState<string[]>([]);

  // The AI pass: reorder the given picks and size each one. Shared by the
  // explicit "Estimate with AI" action and by Plan It For Me, which runs the
  // selection first and then hands the result through here.
  const runAI = async (ids: string[]) => {
    if (!onAIPlan || ids.length === 0) return;
    setAiBusy(true);
    setAiError(false);
    try {
      const picked = allTasks
        .filter((t) => ids.includes(t.id))
        .map((t) => ({ id: t.id, text: t.text, category: t.category, overdue: t.overdue }));
      const result = await onAIPlan(picked, startMin, effEnd);
      const order = result.items.map((r) => r.id).filter((id) => ids.includes(id));
      const leftover = ids.filter((id) => !order.includes(id));
      setPicks([...order, ...leftover]);
      setDurations((prev) => {
        const next = { ...prev };
        result.items.forEach((r) => { next[r.id] = r.minutes; });
        return next;
      });
      setAiEstimates((prev) => {
        const next = { ...prev };
        result.items.forEach((r) => { next[r.id] = r.minutes; });
        return next;
      });
      // Honest attribution (item 04): only strands the model actually cited,
      // already verified against the offered ids. The being-known hit, in the
      // exact place the knowing changed something.
      setLeanedOn(result.leanedOn);
    } catch {
      setAiError(true);
    } finally {
      setAiBusy(false);
    }
  };
  const estimateWithAI = () => { if (!aiBusy) void runAI(picks); };

  // Tapping the row picks or unpicks it, one tap either way. Adjusting a
  // pick is a different intent and lives behind the time chip, so "no, not
  // that one" never costs two taps.
  const toggle = (id: string) => setPicks((prev) => {
    if (prev.includes(id)) { setTuning((t) => (t === id ? null : t)); return prev.filter((x) => x !== id); }
    if (effCap != null && prev.length >= effCap) return prev;
    return [...prev, id];
  });

  const planFor = (ids: string[]) => {
    const rank = new Map(ids.map((id, i) => [id, i] as const));
    const ordered = allTasks.filter((t) => ids.includes(t.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

    // Hand-set times are placed literally first (they're deliberate, per Dave:
    // "you can schedule anything during those times"), then everything else
    // auto-places around events, protected time, AND those manual picks, so
    // two picks never land on top of each other.
    const manual: PlanBlock[] = [];
    const auto: { id: string; text: string; category: string; durationMin: number; windowS?: number; windowE?: number }[] = [];
    for (const t of ordered) {
      const total = durFor(t.id);
      const parts = sittings[t.id] && sittings[t.id]! > 1 ? splitSittings(total) : [total];
      parts.forEach((dur, i) => {
        const id = parts.length > 1 ? `${t.id}#${i + 1}` : t.id;
        const text = parts.length > 1 ? `${t.text} (${i + 1} of ${parts.length})` : t.text;
        const ov = i === 0 ? overrides[t.id] : undefined;
        if (ov) {
          const s = toMin(ov);
          manual.push({ taskId: id, text, category: t.category, start: fromMin(s), end: fromMin(s + dur) });
        } else {
          auto.push({ id, text, category: t.category, durationMin: dur, ...(t.windowS != null ? { windowS: t.windowS } : {}), ...(t.windowE != null ? { windowE: t.windowE } : {}) });
        }
      });
    }
    const manualBusy = manual.map((b) => ({ s: toMin(b.start), e: toMin(b.end) }));
    const { hard, soft, focus } = splitProtectedRanges(blocked);
    const autoResult = planDay(auto, events, startMin, effEnd, BUFFER + sizing.extraSlackMin, [...hard.map((b) => ({ s: b.s, e: b.e })), ...manualBusy], soft, focus);
    const blocks = [...manual, ...autoResult.blocks].sort((a, b) => a.start.localeCompare(b.start));
    return { blocks, unplaced: autoResult.unplaced };
  };

  const plan = useMemo(() => planFor(picks), [picks, allTasks, events, startMin, effEnd, blocked, sizing, durations, overrides, sittings]);
  const ranges = useMemo(() => splitProtectedRanges(blocked), [blocked]);
  const open = useMemo(() => openMinutes(events, blocked, startMin, effEnd), [events, blocked, startMin, effEnd]);
  const load = useMemo(() => loadOf(plan.blocks, plan.unplaced, open), [plan, open]);
  const overflow = useMemo(
    () => (load.fits ? [] : dropToFit(picks, durFor, load.overMin)),
    [load, picks, durations],
  );
  const blockFor = (id: string) => plan.blocks.find((b) => realId(b.taskId) === id);
  const timeFor = (id: string) => blockFor(id)?.start ?? null;

  // P1: pick, size, order and place the whole day in one tap. The selection
  // step is what the old "Estimate with AI" button never did, and picking is
  // the hard part.
  const planItForMe = async () => {
    const chosen = autoSelect(allTasks, open, durFor, effCap ?? null);
    if (chosen.length === 0) return;
    setPicks(chosen);
    setOverrides({});
    setAutoPlanned(true);
    if (onAIPlan) await runAI(chosen);
  };

  const takeFeel = (feel: Feel) => {
    const id = pickByFeel(allTasks, feel, picks, durFor);
    if (id) setPicks((p) => (effCap != null && p.length >= effCap ? p : [...p, id]));
  };

  const takeShape = () => {
    if (!shape) return;
    const { overrides: o, durations: d } = applyShape(shape.shape, picks, startMin, effEnd);
    setOverrides(o);
    setDurations((prev) => ({ ...prev, ...d }));
  };

  const addTask = async () => {
    const text = adding.trim();
    if (!text || !onAddTask) return;
    setAdding("");
    const made = await onAddTask(text);
    if (!made) return;
    setExtra((prev) => [made, ...prev]);
    setPicks((p) => (effCap != null && p.length >= effCap ? p : [...p, made.id]));
  };

  const saveProtect = async () => {
    if (!protecting || !onProtect) return;
    const { label: l, s, e } = protecting;
    if (!l.trim() || !s || !e || toMin(e) <= toMin(s)) return;
    setProtecting(null);
    await onProtect(l.trim(), toMin(s), toMin(e));
  };

  // Only ONE pick shows its controls at a time. Rendering a length chip row
  // and a time field under every pick turned three picks into six hundred
  // pixels of chrome, which is the opposite of the point: the list has to
  // stay readable as a LIST. Tapping a picked row opens its controls.
  const [tuning, setTuning] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const placingTask = placing ? allTasks.find((t) => t.id === placing) : null;
  const placeAt = (min: number) => {
    if (!placing) return;
    const dur = durFor(placing);
    const clamped = Math.max(startMin, Math.min(effEnd - dur, min));
    setOverride(placing, fromMin(clamped));
    setPlacing(null);
  };

  const count = plan.blocks.length;
  const countLabel = count === 1 ? "my one" : count === 2 ? "my two" : count === 3 ? "my three" : `these ${count}`;

  // P8: three labeled groups with counts. It was one flat sorted list, so
  // overdue and someday looked identical.
  const groups = useMemo(() => {
    const overdue = allTasks.filter((t) => t.overdue);
    const dueToday = allTasks.filter((t) => !t.overdue && !!t.due);
    const anytime = allTasks.filter((t) => !t.overdue && !t.due);
    return [
      { key: "overdue", label: "Overdue", rows: overdue },
      { key: "due", label: dayLabel === "Today" ? "Due Today" : "Due " + dayLabel, rows: dueToday },
      { key: "anytime", label: "Anytime", rows: anytime },
    ].filter((g) => g.rows.length > 0);
  }, [allTasks, dayLabel]);

  const commit = () => {
    const day = date;
    picks.forEach((id, i) => emit({ type: "plan.picked", entityType: "task", entityId: id, props: { n: i + 1 } }));
    for (const id of picks) {
      const est = aiEstimates[id];
      if (est == null) continue;
      const delta = durFor(id) - est;
      if (delta === 0) continue;
      const category = allTasks.find((t) => t.id === id)?.category ?? "";
      if (!category) continue;
      emit({ type: "plan.duration_corrected", entityType: "task", entityId: id, props: { category, n: delta } });
    }
    for (const b of plan.blocks) {
      if (!b.category) continue;
      const mins = toMin(b.end) - toMin(b.start);
      if (mins > 0) emit({ type: "plan.duration_committed", entityType: "task", entityId: realId(b.taskId), props: { category: b.category, n: mins } });
    }
    // P12: the rhythm he actually committed, kept so a future day can be
    // planned like this one. Shape only, never the tasks.
    saveShape({
      day,
      dow: new Date(day + "T12:00:00").getDay(),
      slots: plan.blocks.map((b) => ({ startMin: toMin(b.start), min: toMin(b.end) - toMin(b.start) })),
    });
    recordPicks(day, picks);
    onCommit(plan.blocks.map((b) => ({ ...b, taskId: realId(b.taskId) })));
  };

  const hide = (k: string) => setDismissed((d) => ({ ...d, [k]: true }));

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{target === "tomorrow" ? "Plan Tomorrow" : "Plan My Day"}</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">What fits {dayLabel.toLowerCase() === "today" ? "today" : dayLabel}?</div>
          {/* B1: the date is a fact on the sheet now, never a thing you infer
              from which button you tapped a screen ago. */}
          <div className="chip-row">
            {onTarget ? (
              <>
                <button type="button" className={"chip" + (target === "today" ? " chip-on" : "")} onClick={() => onTarget("today")}>Today</button>
                <button type="button" className={"chip" + (target === "tomorrow" ? " chip-on" : "")} onClick={() => onTarget("tomorrow")}>Tomorrow</button>
              </>
            ) : null}
            <div className="chip">{effCap != null ? `Pick up to ${effCap}` : "Pick freely"}</div>
            <div className="chip">Before {label(fromMin(effEnd))}</div>
            {!routineConfigured && <div className="chip">Default Hours</div>}
          </div>
          {!routineConfigured && onEditRoutine && (
            <div className="plan-sub"><button type="button" className="note-fix" onClick={onEditRoutine}>Set Your Routine</button></div>
          )}

          {/* R4: he opened this at 10:54 PM. Planning "today" then is planning
              a dead day, and the sheet used to ask cheerfully anyway. */}
          {clock && onTarget && !dismissed.clock && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{clock.title}</div>
                <div className="conn-meta">{clock.sub}</div>
              </div>
              <button type="button" className="pill-act" onClick={() => { hide("clock"); onTarget("tomorrow"); }}>Plan Tomorrow</button>
            </div></div>
          )}

          {(events.length > 0 || blocked.length > 0 || plan.blocks.length > 0) && (
            <PlanStrip
              startMin={startMin}
              endMin={effEnd}
              events={events}
              blocked={blocked}
              blocks={plan.blocks}
              onTapMin={placing ? placeAt : undefined}
              onDragBlock={(taskId, min) => {
                const id = realId(taskId);
                const dur = durFor(id);
                setOverride(id, fromMin(Math.max(startMin, Math.min(effEnd - dur, min))));
              }}
            />
          )}
          {/* P2: how full the day is, said before he commits rather than after. */}
          <div className={"plan-load" + (load.fits ? "" : " over")}>{loadLine(load, picks.length)}</div>
          {placingTask && (
            <div className="plan-sub">Tap where &ldquo;{placingTask.text}&rdquo; goes</div>
          )}

          {/* P3: the day says no where the picking happens, with the fix in
              the same breath. It used to appear as grey text at the bottom. */}
          {overflow.length > 0 && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{dropLine(overflow.length)}</div>
                <div className="conn-meta">You&rsquo;re {hhmm(load.overMin)} over what&rsquo;s open</div>
              </div>
              <button type="button" className="pill-act" onClick={() => setPicks((p) => p.filter((id) => !overflow.includes(id)))}>
                {overflow.length === 1 ? "Drop It" : `Drop ${overflow.length}`}
              </button>
            </div></div>
          )}

          {/* B3: the plan he already made, which the list correctly drops and
              wrongly never mentioned. */}
          {alreadyPlanned.length > 0 && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{alreadyPlanned.length === 1 ? "1 Already Planned" : `${alreadyPlanned.length} Already Planned`}</div>
                <div className="conn-meta truncate">{alreadyPlanned.join(", ")}</div>
              </div>
            </div></div>
          )}

          {/* B2: five rows became one. Three of them existed to tell him when
              he eats. The detail is a tap away, it just stops shouting. */}
          {(ranges.focus.length > 0 || ranges.hard.length > 0 || ranges.soft.length > 0) && (
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={() => setExpandRoutine((v) => !v)}>
                <div className="row-stack">
                  <div className="conn-name">
                    {ranges.focus[0]
                      ? `Picks Land in ${ranges.focus[0].label}, ${label(fromMin(ranges.focus[0].s))}`
                      : "Your Protected Time"}
                  </div>
                  <div className="conn-meta">
                    {[
                      ranges.hard.length > 0 ? "Around " + ranges.hard.map((b) => b.label).join(", ") : "",
                      ranges.soft.length > 0 ? capAfterNumber(`${ranges.soft.length} flexible if it's tight`) : "",
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="see-all">{expandRoutine ? "Hide" : "Show"}</span>
              </div>
              {expandRoutine && (
                <>
                  {ranges.focus.map((b) => (
                    <div className="row" key={"f" + b.s}>
                      <span className="cat-dot cat-bg-blue" />
                      <div className="row-stack"><div className="conn-name">{b.label}</div><div className="conn-meta">Focus · Picks land here</div></div>
                      <span className="urgency urgency-muted">{label(fromMin(b.s))}–{label(fromMin(b.e))}</span>
                    </div>
                  ))}
                  {ranges.hard.map((b) => (
                    <div className="row" key={"h" + b.s}>
                      <span className="cat-dot cat-bg-graphite" />
                      <div className="row-stack"><div className="conn-name">{b.label}</div><div className="conn-meta">Protected · Routed around</div></div>
                      <span className="urgency urgency-muted">{label(fromMin(b.s))}–{label(fromMin(b.e))}</span>
                    </div>
                  ))}
                  {ranges.soft.map((b) => (
                    <div className="row" key={"s" + b.s}>
                      <span className="cat-dot cat-bg-teal" />
                      <div className="row-stack"><div className="conn-name">{b.label}</div><div className="conn-meta">Flexible · Used when tight</div></div>
                      <span className="urgency urgency-muted">{label(fromMin(b.s))}–{label(fromMin(b.e))}</span>
                    </div>
                  ))}
                </>
              )}
              {onProtect && (
                protecting ? (
                  <div className="row plan-protect">
                    <input className="input input-compact" placeholder="What to Protect" value={protecting.label} onChange={(e) => setProtecting({ ...protecting, label: e.target.value })} />
                    <input type="time" className="input input-compact" aria-label="Protect from" value={protecting.s} onChange={(e) => setProtecting({ ...protecting, s: e.target.value })} />
                    <input type="time" className="input input-compact" aria-label="Protect until" value={protecting.e} onChange={(e) => setProtecting({ ...protecting, e: e.target.value })} />
                    <button type="button" className="pill-act" onClick={() => void saveProtect()}>Save</button>
                  </div>
                ) : (
                  <button type="button" className="row-act" onClick={() => setProtecting({ label: "", s: fromMin(startMin), e: fromMin(Math.min(effEnd, startMin + 60)) })}>Protect Time</button>
                )
              )}
            </div>
          )}

          {/* P5: JARVIS has always planned around his chronotype and never
              said so. Silent intelligence reads as no intelligence. */}
          {peak && !dismissed.peak && (
            <div className="card"><div className="row">
              <span className="cat-dot cat-bg-yellow" />
              <div className="row-stack">
                <div className="conn-name">Your Best Hours Are {label(fromMin(peak.s))}–{label(fromMin(peak.e))}</div>
                <div className="conn-meta">Hard things go there · Admin goes after</div>
              </div>
            </div></div>
          )}

          {/* P4: "2 of 7 picks done same-day" told him he was failing, sitting
              directly above the thing he was about to fail at again. The same
              number pointed forward is a setting. */}
          {cap && capTaken === null && !dismissed.cap && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{cap.title}</div>
                <div className="conn-meta">{cap.sub}</div>
              </div>
              <button type="button" className="pill-act" onClick={() => { setCapTaken(cap.n); setPicks((p) => p.slice(0, cap.n)); }}>Do That</button>
            </div></div>
          )}

          {/* P12: the rhythm of a day that worked, poured over today's picks. */}
          {shape && picks.length > 0 && !dismissed.shape && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{shape.title}</div>
                <div className="conn-meta">{shape.sub}</div>
              </div>
              <button type="button" className="pill-act" onClick={() => { hide("shape"); takeShape(); }}>Use It</button>
            </div></div>
          )}

          {/* P9: some days the list IS the problem. Three buttons that each
              add one task with no reading required. */}
          {allTasks.length > 0 && (
            <div className="chip-row plan-feel">
              {(["quick", "hard", "goal"] as Feel[])
                .filter((f) => feelAvailable(allTasks, f, picks))
                .map((f) => (
                  <button key={f} type="button" className="chip chip-act" onClick={() => takeFeel(f)}>{FEEL_LABEL[f]}</button>
                ))}
            </div>
          )}

          {onAIPlan && picks.length > 0 && (
            <div className="input-note">
              <button type="button" className="note-fix" disabled={aiBusy} onClick={estimateWithAI}>
                {aiBusy ? "Estimating…" : "Re-Estimate Lengths"}
              </button>
              {aiError && <span>Couldn&rsquo;t reach the AI · lengths unchanged</span>}
            </div>
          )}
          {leanedOn.length > 0 && !aiBusy && (
            <div className="input-note"><span>Leaning on: {leanedOn[0]}</span></div>
          )}

          {allTasks.length === 0 ? (
            <div className="empty-state"><div className="t-body">Nothing to plan yet</div></div>
          ) : (
            <div className="p3-list">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="grp"><div className="eyebrow">{g.label} · {g.rows.length}</div></div>
                  {g.rows.map((t) => {
                    const i = picks.indexOf(t.id);
                    const on = i >= 0;
                    const at = on ? timeFor(t.id) : null;
                    const dur = durFor(t.id);
                    const chunks = sittings[t.id] && sittings[t.id]! > 1 ? splitSittings(dur) : null;
                    return (
                      <div key={t.id}>
                        <div className={"p3-row" + (on ? " on" : "")} role="button" tabIndex={0} onClick={() => toggle(t.id)}>
                          <div className="p3-num">{on ? i + 1 : ""}</div>
                          <span className={"cat-dot cat-bg-" + catColor(t.category)} />
                          <div className="row-grow">
                            <div className="p3-name truncate">{t.text}</div>
                            {t.goal && <div className="bp-sub truncate">Moves {t.goal}</div>}
                            {on && blockFor(t.id)?.outsideWindow && (
                              <div className="bp-sub">Outside its work hours</div>
                            )}
                            {on && blockFor(t.id)?.overSoft && (
                              <div className="bp-sub">Overlaps your {blockFor(t.id)!.overSoft}; the day is tight, move it if that doesn&rsquo;t work</div>
                            )}
                            {chunks && <div className="bp-sub">{splitLine(chunks)}</div>}
                          </div>
                          {on ? (
                            <button
                              type="button"
                              className={"p3-time p3-time-btn" + (tuning === t.id ? " placing" : "")}
                              aria-label={`${t.text}: adjust`}
                              onClick={(e) => { e.stopPropagation(); setPlacing(null); setTuning((p) => (p === t.id ? null : t.id)); }}
                            >
                              {at ? label(at) : "No room"}
                            </button>
                          ) : t.overdue ? (
                            <span className="plan-overdue">Overdue</span>
                          ) : null}
                        </div>
                        {on && tuning === t.id && (
                          <div className="plan-controls" onClick={(e) => e.stopPropagation()}>
                            {/* P6: chips, not a stepper. 45m to 2h was five taps.
                                The readout stays: a learned or AI-estimated
                                length is any number of minutes, and the six
                                chips cannot represent all of them. Hiding the
                                real value behind an unlit chip row would be
                                the sheet knowing something and not saying it. */}
                            <div className="chip-row plan-durs">
                              {/* Only when no chip can say it: a learned or
                                  AI length is any number of minutes, and an
                                  unlit chip row would hide the real value.
                                  When a chip matches, the chip IS the readout. */}
                              {!DUR_CHOICES.includes(dur) && <span className="plan-dur">{dur}m</span>}
                              {DUR_CHOICES.map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  className={"chip" + (dur === d ? " chip-on" : "")}
                                  aria-label={`${t.text}: ${d} minutes`}
                                  onClick={() => setDur(t.id, d)}
                                >
                                  {d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h ${d % 60}m`}
                                </button>
                              ))}
                            </div>
                            <div className="plan-when">
                              <input
                                type="time"
                                className="input input-compact"
                                aria-label={`${t.text}: time`}
                                value={overrides[t.id] ?? at ?? ""}
                                onChange={(e) => setOverride(t.id, e.target.value)}
                              />
                              <button
                                type="button"
                                className={"plan-drop" + (placing === t.id ? " placing" : "")}
                                aria-label={`${t.text}: place on the day`}
                                onClick={() => setPlacing((p) => (p === t.id ? null : t.id))}
                              >
                                {placing === t.id ? "Tap the Strip" : "Place"}
                              </button>
                              {overrides[t.id] && (
                                <button type="button" className="plan-drop" onClick={() => clearOverride(t.id)}>Auto</button>
                              )}
                              {/* P13: a three-hour task is not a three-hour sitting. */}
                              {dur > SITTING_MAX && (
                                <button
                                  type="button"
                                  className="plan-drop"
                                  onClick={() => setSittings((s) => ({ ...s, [t.id]: s[t.id] && s[t.id]! > 1 ? 1 : 2 }))}
                                >
                                  {chunks ? "One Sitting" : "Split It"}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {/* Utility controls sit BELOW the list. Above it they pushed the
              actual tasks off the bottom of a 390px phone, which made a
              planning sheet whose main job you had to scroll to reach. */}
          {/* P11: one field that reshapes the day. The routine window was the
              only end time and could not be changed for a single day. */}
          <div className="row plan-doneby">
            <div className="row-grow"><div className="conn-name">Done By</div></div>
            <input type="time" className="input input-compact" aria-label="Done by" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} />
            {doneBy && <button type="button" className="plan-drop" onClick={() => setDoneBy("")}>Clear</button>}
          </div>

          {/* P7: if the thing he actually wants to do is not already a task,
              he had to close the sheet, go make it, and come back. */}
          {onAddTask && (
            <div className="row plan-add">
              <input
                className="input input-compact"
                placeholder="Add Something to This Day"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }}
              />
              <button type="button" className="pill-act" disabled={!adding.trim()} onClick={() => void addTask()}>Add</button>
            </div>
          )}

        </div>
        <div className="pad-x sheet-actions">
          {/* R5 + P1: the primary was "Pick your tasks", which is the app
              telling him to go do the work it exists to do. Nothing picked
              now means one tap plans the whole day. */}
          {count === 0 ? (
            <button className="btn btn-primary btn-block" disabled={allTasks.length === 0 || aiBusy} onClick={() => void planItForMe()}>
              {aiBusy ? "Planning…" : "Plan It For Me"}
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={commit}>
              {autoPlanned ? `Accept ${countLabel === "these 1" ? "It" : "the Plan"}` : `Add ${countLabel}`}
            </button>
          )}
          {count > 0 && !autoPlanned && allTasks.length > picks.length && (
            <button className="btn btn-secondary btn-block" disabled={aiBusy} onClick={() => void planItForMe()}>
              {aiBusy ? "Planning…" : "Plan It For Me"}
            </button>
          )}
          {count > 0 && autoPlanned && (
            <button className="btn btn-secondary btn-block" onClick={() => setAutoPlanned(false)}>Change It</button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
