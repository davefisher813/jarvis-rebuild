import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventItem } from "../types";
import { planDay, type PlanBlock } from "../planDay";
import { fmtTime } from "../calendar";
import { catColor, catName } from "../../shared/categories";
import { movesLine } from "../../today/goalPulse";
import { useOptionalRules } from "../../data/NotesProvider";
import { FULL_DAY, type DaySizing } from "../daySizing";
import { emit, eventLog } from "../../events";
import { planRecord } from "../../events/planOutcome";
import { learnedDurations, readCommittedDurations } from "../learnedDurations";
import PlanStrip from "./PlanStrip";
import { splitProtectedRanges, type BlockKind } from "../../routine/types";
import { openMinutes, loadOf, loadLine, dropToFit, dropLine, hhmm, autoSelect } from "../planLoad";
import { capOffer } from "../planCap";
import { splitSittings, splitLine, SITTING_MAX } from "../splitSitting";
import { dayClock } from "../planClock";
import { planCount } from "../dayShape";
import { estimateFor } from "../padding";
import { capAfterNumber } from "../../shared/casing";
import { DUR_CHOICES } from "../durations";

const BUFFER = 10;
const DEFAULT_DUR = 45;
const DUR_MIN = 15;
const DUR_MAX = 240;
// P6 (Dave 2026-08-20): 45m to 2h was five taps on a stepper. Chips do it in
// one. The set is the lengths real work actually comes in.
//
// B5 (2026-08-23): that set now lives in schedule/durations.ts. It was
// declared here AND exported from ProposedRow, two identical lists with
// nothing keeping them identical.

// A protected range shown in the plan: gym, meals, deep work. Fed to the planner
// as busy time so proposed blocks route around it. soft ranges are preferences
// used only when the day is tight; focus ranges pull picks IN.
export interface PlanBlocked { s: number; e: number; label: string; soft?: boolean; kind?: BlockKind }
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

// PLAN MY DAY, rebuilt around one decision (2026-08-22).
//
// Dave, with a screenshot of the previous sheet: "the plan my day page is the
// worst thing in the app. It's confusing, buttons don't work, logic sucks."
// The audit agreed. Twenty-odd control systems in one scroll; chips that were
// statements dressed as buttons; a Place mode whose target sat scrolled
// off-screen; taps at the cap that did nothing, silently; and a sheet that
// opened by asking HIM to do the planning it exists to do.
//
// The engine underneath was never the problem, so it stays. The sheet now:
//   - OPENS ALREADY PLANNED. autoSelect picks a day the moment it mounts,
//     deterministically; the first render is a finished plan and one primary
//     button. The AI pass refines lengths in the background and is never
//     waited on.
//   - ONE QUIET LINE says how it fits, where the coach cards used to stack.
//     His finish rate steers the auto-pick silently and the line says
//     "Your usual" instead of a card asking him to approve his own average.
//   - NO SILENT CAPS. Any tap picks; the fit line and the Won't Fit card
//     push back where pushing back is honest.
//   - PLACING YOU CAN SEE. While placing, the strip pins to the top of the
//     sheet so the target is on screen. Drag is gone; a tap places.
//   - TWO FOOTER BUTTONS, always. The primary and Cancel.
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
  seed = null,
  routineConfigured = true,
  blocked = [],
  sizing = FULL_DAY,
  onEditRoutine,
  onAddTask,
  onCommit,
  chosenCap,
  onClose,
  onAIPlan,
}: {
  events: EventItem[];
  tasks: PlanCandidate[];
  startMin: number;
  endMin: number;
  // B1 (2026-08-20): the sheet is told which day it is filling, and says so.
  date: string;
  dayLabel: string;
  target?: "today" | "tomorrow";
  onTarget?: (t: "today" | "tomorrow") => void;
  // What is ALREADY on this day from a previous plan. The list drops these
  // (correctly, they are placed) and the fit line says so.
  alreadyPlanned?: string[];
  // The standing draft's picks and lengths (merge phase 1). When present the
  // sheet EDITS that proposal instead of making a competing one.
  seed?: { ids: string[]; minutes: Record<string, number> } | null;
  routineConfigured?: boolean;
  blocked?: PlanBlocked[];
  sizing?: DaySizing;
  onEditRoutine?: () => void;
  // P7: make a task without leaving the sheet.
  onAddTask?: (text: string) => Promise<PlanCandidate | null>;
  onCommit: (blocks: PlanBlock[], picks: string[]) => void;
  // The user's chosen day cap from the monthly report, when set.
  chosenCap?: number;
  onClose: () => void;
  onAIPlan?: (picks: { id: string; text: string; category: string; overdue: boolean }[], startMin: number, endMin: number) => Promise<{ items: { id: string; minutes: number }[]; leanedOn: string[] }>;
}) {
  // Optional: the plan sheet renders in places that may sit outside the
  // rules provider, and a missing store must mean "learn nothing", not a crash.
  const rules = useOptionalRules();
  const [extra, setExtra] = useState<PlanCandidate[]>([]);
  const allTasks = useMemo(() => [...extra, ...tasks], [extra, tasks]);

  const [durations, setDurations] = useState<Record<string, number>>({});
  // APPLYING WHAT IT LEARNED (2026-08-24). Two identical overrides of the AI's
  // estimate for a category made a rule; this is the decision point it exists
  // to answer. Held apart from `durations` on purpose, because `durations` is
  // "a length somebody chose for this task" and these are "a length he
  // chose for this KIND of task, twice". Keeping them separate is what lets
  // durFor rank them and lets the AI pass know to stay out of the way.
  const [ruled, setRuled] = useState<Record<string, number>>({});
  const ruledRef = useRef<Record<string, number>>({});
  ruledRef.current = ruled;
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // P13: how many sittings a pick is broken into. 1 unless he says otherwise.
  const [sittings, setSittings] = useState<Record<string, number>>({});
  // P11: a one-day end time. The routine's window is the default, not a cage.
  const [doneBy, setDoneBy] = useState<string>("");
  const [doneByOpen, setDoneByOpen] = useState(false);
  const [adding, setAdding] = useState("");
  const [expandRoutine, setExpandRoutine] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const effEnd = doneBy ? Math.min(endMin, toMin(doneBy)) : endMin;

  const learned = useMemo(() => learnedDurations(readCommittedDurations(), Date.now()), []);
  const log = useMemo(() => eventLog.all(), []);
  const record = useMemo(() => planRecord(log, Date.now()), [log]);
  const cap = useMemo(() => capOffer(record, planCount(log)), [record, log]);
  const clock = target === "today" ? dayClock(startMin, effEnd) : null;

  const catOf = (id: string) => allTasks.find((t) => t.id === realId(id))?.category ?? "";
  const estFor = (id: string) => estimateFor(catOf(id), learned, DEFAULT_DUR, DUR_CHOICES);
  // Precedence, most specific first: a length chosen for THIS task this
  // session beats a rule about this kind of task, which beats the statistical
  // estimate from committed history. His hands always win.
  const durFor = (id: string) => durations[id] ?? ruled[id] ?? estFor(id).minutes;
  const setDur = (id: string, next: number) => setDurations((prev) => ({ ...prev, [id]: Math.max(DUR_MIN, Math.min(DUR_MAX, next)) }));
  const setOverride = (id: string, hhmmStr: string) => setOverrides((prev) => {
    if (!hhmmStr) { const n = { ...prev }; delete n[id]; return n; }
    return { ...prev, [id]: hhmmStr };
  });
  const clearOverride = (id: string) => setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const open = useMemo(() => openMinutes(events, blocked, startMin, effEnd), [events, blocked, startMin, effEnd]);

  // IT OPENS ALREADY PLANNED. Deterministic, instant, and capped at his real
  // finish rate when the log knows one: planning six for a man who finishes
  // three is planning three failures. Picking more is one tap, never gated.
  const seededRef = useRef(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [usedUsual, setUsedUsual] = useState(false);
  // Seeded from a standing draft rather than from autoSelect: the AI refine
  // stands down in that case (below), so the sheet cannot renumber a plan
  // the card already showed him.
  const fromDraft = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    // ONE PROPOSED DAY (merge phase 1). If a draft is standing for this day,
    // THAT is the proposal and the sheet opens editing it. Running
    // autoSelect here as well was the second auto-planner: it re-picked from
    // scratch, so "Edit" silently discarded the card's plan.
    if (seed && seed.ids.length > 0) {
      fromDraft.current = true;
      setPicks(seed.ids);
      // The card showed these lengths. The sheet opens agreeing with it.
      setDurations(seed.minutes);
    } else {
      // His chosen cap outranks the evidence-derived offer (the monthly
      // report's one change, 2026-08-25); evidence fills its absence.
      const seedCap = chosenCap ?? cap?.n ?? sizing.maxBlocks ?? 3;
      const chosen = autoSelect(allTasks, open, durFor, seedCap);
      if (chosen.length > 0) {
        setPicks(chosen);
        if (cap?.n != null && chosen.length === cap.n) setUsedUsual(true);
      }
    }
  }

  // Resolve the duration rules for the categories on screen, once per set of
  // picks. Runs against picks rather than the whole task list so the store is
  // read for lengths that are actually about to be shown.
  //
  // Four refusals, the same shape as the capture side, and each is the
  // difference between a rule and a guess:
  //
  //   1. A task with no category has nothing for a rule to key on.
  //   2. No rule for that category means fall through to the statistical
  //      estimate, which is already honest.
  //   3. A rule whose length is not a real length (a corrupt row, or a clamp
  //      that has since changed) is ignored rather than clamped into
  //      something he never chose.
  //   4. A rule that agrees with the estimate changes nothing, so it is not a
  //      USE and must not announce.
  //
  // The announcement is the deal. types.ts: "Every rule announces itself on
  // first use. Visibility is what licenses creating it without a tap." The
  // first time a rule silently changes a length is the moment it has to say
  // so, and laws.test.ts fails if this file resolves without announcing.
  const ruleAsked = useRef<string>("");
  useEffect(() => {
    if (!rules || picks.length === 0) return;
    const cats = [...new Set(picks.map((id) => catOf(id)).filter(Boolean))];
    const key = cats.slice().sort().join("|");
    if (!key || key === ruleAsked.current) return;
    ruleAsked.current = key;
    let live = true;
    void (async () => {
      const found: Record<string, number> = {};
      for (const cat of cats) {
        let rule;
        try {
          rule = await rules.resolve("plan.duration", cat);
        } catch {
          continue; // a store that cannot be read teaches nothing this time
        }
        if (!rule) continue;
        const mins = Number(rule.data.to);
        if (!Number.isFinite(mins) || mins < DUR_MIN || mins > DUR_MAX) continue;
        let used = false;
        for (const id of picks) {
          if (catOf(id) !== cat) continue;
          if (estimateFor(cat, learned, DEFAULT_DUR, DUR_CHOICES).minutes === mins) continue;
          found[id] = mins;
          used = true;
        }
        if (used) await rules.announceIfFirstUse(rule);
      }
      if (live && Object.keys(found).length) setRuled((prev) => ({ ...found, ...prev }));
    })();
    return () => { live = false; };
    // catOf and learned are derived from props that do not change while the
    // sheet is open; ruleAsked is what actually stops this repeating.
  }, [rules, picks]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiEstimates, setAiEstimates] = useState<Record<string, number>>({});
  const [leanedOn, setLeanedOn] = useState<string[]>([]);

  // The AI pass refines lengths in the BACKGROUND. It is launched once, on
  // mount, and its result applies only to ids still picked when it lands: he
  // may have repicked while it ran, and a reply must never undo his hands.
  // No spinner, no error surface: a failed refine leaves the learned
  // estimates, which are already honest.
  const launchedFor = useRef<string[]>([]);
  const runAI = async (ids: string[]) => {
    if (!onAIPlan || ids.length === 0 || aiBusy) return;
    launchedFor.current = ids;
    setAiBusy(true);
    try {
      const picked = allTasks
        .filter((t) => ids.includes(t.id))
        .map((t) => ({ id: t.id, text: t.text, category: t.category, overdue: t.overdue }));
      const result = await onAIPlan(picked, startMin, effEnd);
      setPicks((current) => {
        const stillMine = launchedFor.current.join("|") === ids.join("|");
        const order = result.items.map((r) => r.id).filter((id) => current.includes(id));
        const leftover = current.filter((id) => !order.includes(id));
        setDurations((prev) => {
          const next = { ...prev };
          // A rule was learned FROM him overriding this estimate, twice. Letting
          // the estimate win here would undo the lesson every single time.
          result.items.forEach((r) => {
            if (current.includes(r.id) && prev[r.id] == null && ruledRef.current[r.id] == null) next[r.id] = r.minutes;
          });
          return next;
        });
        setAiEstimates((prev) => {
          const next = { ...prev };
          result.items.forEach((r) => { next[r.id] = r.minutes; });
          return next;
        });
        setLeanedOn(result.leanedOn);
        // Reorder only when his picks are untouched since launch.
        return stillMine && order.length === current.length ? [...order, ...leftover] : current;
      });
    } catch { /* refine is best-effort by design */ } finally {
      setAiBusy(false);
    }
  };
  const aiLaunched = useRef(false);
  useEffect(() => {
    // A draft-seeded sheet is already a plan he has been shown, with times
    // on the card behind it. Refining it would move those lengths and the
    // two surfaces would disagree again -- and it would spend a call to
    // re-answer a question the deterministic engine already answered.
    if (fromDraft.current) return;
    if (aiLaunched.current || picks.length === 0) return;
    aiLaunched.current = true;
    void runAI(picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);

  // Tapping a row picks or unpicks it. NO silent cap: the fit line and the
  // Won't Fit card push back honestly instead of a tap doing nothing.
  const toggle = (id: string) => setPicks((prev) => {
    if (prev.includes(id)) { setTuning((t) => (t === id ? null : t)); return prev.filter((x) => x !== id); }
    setUsedUsual(false);
    return [...prev, id];
  });

  // Commit-time floor: the sheet can sit open while the clock walks past its
  // own proposals; committing re-places auto picks from the real now.
  // Hand-set times stay literal: overriding is deliberate.
  const planFor = (ids: string[], floorMin: number = startMin) => {
    const rank = new Map(ids.map((id, i) => [id, i] as const));
    const ordered = allTasks.filter((t) => ids.includes(t.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
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
    const autoResult = planDay(auto, events, floorMin, effEnd, BUFFER + sizing.extraSlackMin, [...hard.map((b) => ({ s: b.s, e: b.e })), ...manualBusy], soft, focus);
    const blocks = [...manual, ...autoResult.blocks].sort((a, b) => a.start.localeCompare(b.start));
    return { blocks, unplaced: autoResult.unplaced };
  };

  const plan = useMemo(() => planFor(picks), [picks, allTasks, events, startMin, effEnd, blocked, sizing, durations, overrides, sittings]);
  const ranges = useMemo(() => splitProtectedRanges(blocked), [blocked]);
  const load = useMemo(() => loadOf(plan.blocks, plan.unplaced, open), [plan, open]);
  const overflow = useMemo(
    () => (load.fits ? [] : dropToFit(picks, durFor, load.overMin)),
    [load, picks, durations],
  );
  const blockFor = (id: string) => plan.blocks.find((b) => realId(b.taskId) === id);
  const timeFor = (id: string) => blockFor(id)?.start ?? null;

  const addTask = async () => {
    const text = adding.trim();
    if (!text || !onAddTask) return;
    setAdding("");
    const made = await onAddTask(text);
    if (!made) return;
    setExtra((prev) => [made, ...prev]);
    setUsedUsual(false);
    setPicks((p) => [...p, made.id]);
  };

  // Only ONE pick shows its controls at a time; the list stays a list.
  const [tuning, setTuning] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const placeAt = (min: number) => {
    if (!placing) return;
    const dur = durFor(placing);
    const clamped = Math.max(startMin, Math.min(effEnd - dur, min));
    setOverride(placing, fromMin(clamped));
    setPlacing(null);
  };

  const count = plan.blocks.length;
  const pickCount = picks.length;

  // ONE QUIET LINE where the coach cards used to stack. Everything on it is
  // true of THIS plan; nothing on it asks a question.
  const quiet = [
    loadLine(load, pickCount),
    usedUsual ? "Your usual" : "",
    alreadyPlanned.length > 0 ? capAfterNumber(`${alreadyPlanned.length} already planned`) : "",
  ].filter(Boolean).join(" · ");

  // P8: three labeled groups with counts, not one flat list.
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
    // No past placements for today (invariant, hotfix 2026-08-21).
    let committed = plan.blocks;
    if (target === "today") {
      const dNow = new Date();
      const nowM = dNow.getHours() * 60 + dNow.getMinutes();
      const stale = plan.blocks.some((b) => !overrides[realId(b.taskId)] && toMin(b.start) < nowM);
      if (stale && nowM > startMin) committed = planFor(picks, Math.ceil(nowM / 15) * 15).blocks;
    }
    // plan.picked, plan.duration_committed, recordPicks and saveShape all
    // moved into ScheduleService.commitPlan (the one event door, audit
    // 2026-08-25); the host passes `picks` through onCommit. The correction
    // signal stays here because the AI estimates are sheet state.
    for (const id of picks) {
      const est = aiEstimates[id];
      if (est == null) continue;
      const delta = durFor(id) - est;
      if (delta === 0) continue;
      const category = allTasks.find((t) => t.id === id)?.category ?? "";
      if (!category) continue;
      emit({ type: "plan.duration_corrected", entityType: "task", entityId: id, props: { category, n: delta } });
      // A CORRECTION, RECORDED (2026-08-24). The AI estimated this task at
      // `est` minutes and Dave committed something else. That is the tuning
      // signal the learned-rules engine was built for and had never been
      // given: recordCorrection had zero callers.
      //
      // The rule keys on the CATEGORY and resolves to the length he actually
      // commits, so two identical overrides mean "Work means 90 minutes",
      // not "Work runs 15 minutes long", because a rule has to answer a
      // question at a decision point and the question is how long to book.
      //
      // RECORDING ONLY, by Dave's decision: nothing calls resolve(), so no
      // plan is ever sized by a rule. The page fills so the rules can be
      // judged before they are allowed to act.
      if (rules) {
        const mins = durFor(id);
        void rules.recordCorrection(
          "tuning", "plan.duration", category, String(mins),
          `${catName(category)} estimated at ${est}m, committed at ${mins}m`,
        ).catch(() => { /* the next identical override re-observes it */ });
      }
    }
    onCommit(committed.map((b) => ({ ...b, taskId: realId(b.taskId) })), picks.map(realId));
  };

  const hide = (k: string) => setDismissed((d) => ({ ...d, [k]: true }));
  // "By 9:30 PM", not "Done by 9:30 PM": the long form pushed the chip row
  // past 390 and the row scrolled, which clipped Today half off the left
  // edge (measured 395 in a 356 slot).
  const doneByLabel = "By " + label(fromMin(effEnd));

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{target === "tomorrow" ? "Plan Tomorrow" : "Plan My Day"}</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">What fits {dayLabel.toLowerCase() === "today" ? "today" : dayLabel}?</div>
          {/* Every chip on this row is a CONTROL. The old row mixed working
              chips with statements dressed as chips, which is where "buttons
              don't work" started being true. */}
          <div className="chip-row">
            {onTarget ? (
              <>
                <button type="button" className={"chip" + (target === "today" ? " chip-on" : "")} onClick={() => onTarget("today")}>Today</button>
                <button type="button" className={"chip" + (target === "tomorrow" ? " chip-on" : "")} onClick={() => onTarget("tomorrow")}>Tomorrow</button>
              </>
            ) : null}
            <button type="button" className={"chip" + (doneBy ? " chip-on" : "")} onClick={() => setDoneByOpen((v) => !v)}>
              {doneByLabel}
            </button>
          </div>
          {doneByOpen && (
            <div className="row plan-doneby">
              <div className="row-grow"><div className="conn-name">Done By</div></div>
              <input type="time" className="input input-compact" aria-label="Done by" value={doneBy || fromMin(effEnd)} onChange={(e) => setDoneBy(e.target.value)} />
              {doneBy && <button type="button" className="plan-drop" onClick={() => { setDoneBy(""); setDoneByOpen(false); }}>Clear</button>}
            </div>
          )}
          {!routineConfigured && onEditRoutine && (
            <div className="plan-sub"><button type="button" className="note-fix" onClick={onEditRoutine}>Set Your Routine</button></div>
          )}

          {/* R4: planning "today" at 10:54 PM is planning a dead day, and the
              sheet used to ask cheerfully anyway. */}
          {clock && onTarget && !dismissed.clock && (
            <div className="card"><div className="row">
              <div className="row-stack">
                <div className="conn-name">{clock.title}</div>
                <div className="conn-meta">{clock.sub}</div>
              </div>
              <button type="button" className="pill-act" onClick={() => { hide("clock"); onTarget("tomorrow"); }}>Plan Tomorrow</button>
            </div></div>
          )}

          {/* While placing, the strip PINS so the thing being aimed at is on
              screen. The old sheet entered a mode whose target sat scrolled
              away above. */}
          {(events.length > 0 || blocked.length > 0 || plan.blocks.length > 0) && (
            <div className={placing ? "strip-pinned" : undefined}>
              <PlanStrip
                startMin={startMin}
                endMin={effEnd}
                events={events}
                blocked={blocked}
                blocks={plan.blocks}
                onTapMin={placing ? placeAt : undefined}
              />
            </div>
          )}
          <div className={"plan-load" + (load.fits ? "" : " over")}>{quiet}</div>

          {/* The day says no where the picking happens, with the fix in the
              same breath. */}
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

          {/* B2: the routine as ONE collapsed row; Edit Routine is the door
              to changing it. The inline protect form is gone with the rest
              of the sheet's second jobs. */}
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
                      ranges.soft.length > 0 ? capAfterNumber(`${ranges.soft.length} flexible`) : "",
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
                  {onEditRoutine && (
                    <button type="button" className="row-act" onClick={onEditRoutine}>Edit Routine</button>
                  )}
                </>
              )}
            </div>
          )}

          {allTasks.length === 0 ? (
            // B14: the sheet already owns an add-task row at the bottom; an
            // empty plan pointed at nothing while the fix sat off screen.
            <div className="empty-state"><div className="t-body">Nothing to Plan Yet</div>
              {onAddTask && <div className="empty-sub">Add something below and it lands here picked</div>}</div>
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
                            {/* PICK 31 applies here too: a goal whose whole
                                name is already in the task title costs a
                                line and says nothing. Same helper the Now
                                card uses, so the two cannot disagree about
                                when lineage is worth printing. */}
                            {movesLine(t.goal, t.text) && <div className="bp-sub truncate">{movesLine(t.goal, t.text)}</div>}
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
                            {/* P6: chips, not a stepper. The readout survives
                                only when no chip can say the real number. */}
                            <div className="chip-row plan-durs">
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
                                {placing === t.id ? "Placing" : "Place"}
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

          {/* P7: if the thing he wants to do is not a task yet, it becomes
              one here, picked, without leaving the sheet. */}
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
          {leanedOn.length > 0 && !aiBusy && (
            <div className="input-note"><span>Leaning on: {leanedOn[0]}</span></div>
          )}

        </div>
        <div className="pad-x sheet-actions">
          {/* TWO BUTTONS, always. With nothing picked the primary replans;
              with picks it commits. Cancel is Cancel. */}
          {count === 0 ? (
            <button
              className="btn btn-primary btn-block"
              disabled={allTasks.length === 0}
              onClick={() => {
                const chosen = autoSelect(allTasks, open, durFor, cap?.n ?? sizing.maxBlocks ?? 3);
                if (chosen.length === 0) return;
                setPicks(chosen);
                setOverrides({});
                if (cap?.n != null && chosen.length === cap.n) setUsedUsual(true);
                void runAI(chosen);
              }}
            >
              Plan It For Me
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={commit}>
              {count === 1 ? "Add This One" : `Add These ${count}`}
            </button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
