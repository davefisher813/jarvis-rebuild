import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sourceOpener } from "../shared/openSource";
import { rowSource } from "../shared/provenance";
import { useSchedule, useCategories, useTasks, useRoutine, useProjects, useGoals, useProfile, useNotes, useOptionalStrands, useOptionalRules, useOptionalGym } from "../data/NotesProvider";
import { rememberTravel, type TravelMemory } from "./leaveBy";
import GymFlow, { readActiveProgramId } from "../gym/GymFlow";
import { doorInfoFor } from "../gym/door";
import { readGymSettings, rackFrom } from "../gym/settings";
import type { Program, Workout } from "../gym/types";
import { pausedCategoryIds } from "../categories/kinds";
import { workWindowOf } from "./planMeta";
import { buildGoalIndex, liveGoals, goalTitleForTask } from "../bigger/reach";
import { buildParentIndex, parentForTask } from "../life/parent";
import { weekRowsFor } from "./weekRows";
import type { Category } from "../categories/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import SchedulePage from "./screens/SchedulePage";
import EventSheet, { type SheetCategory, type EventDraft } from "./screens/EventSheet";
import BlockSheet, { type BlockDraft } from "./screens/BlockSheet";
import ScheduleUploadFlow from "./screens/ScheduleUploadFlow";
import { todayISO, weekOf, addDays, addMinutes, fmtTime, eventsForDate, nextFreeSlot, fmtRange, minToHHMM, nextOccurrence, daysBetween, shiftFitsDay } from "./calendar";
import { durLabel } from "./durations";
import { isKept, keepBoth } from "./overlapAck";
import OverlapSheet from "./screens/OverlapSheet";
import { planDay } from "./planDay";
import { anytimeTasksForDay } from "./anytime";
import { suggestTitles, suggestLocations, repeatCandidate } from "./memory";
import { attachInfo, firstMoveOf, followUpCandidate, type AttachInfo } from "./attachments";
import { bestPerBlock, blockKind, recordBlend, loadBlendMemory } from "./blend";
import type { EventItem, EventData } from "./types";
import { showToast } from "../shared/toast";
import { catColor } from "../shared/categories";
import { attemptWrite } from "../shared/guard";
import PlanDaySheet from "./screens/PlanDaySheet";
import { readDraft, writeDraft, acceptInto, seedFrom, editDraft, liveBlocks, plannedTaskIds as draftClaims } from "../dayloop/dayLoop";
import { aiPlanDay } from "./planDayAI";
import { DEFAULT_ROUTINE, planWindowFor, protectedRangesFor, splitProtectedRanges, type RoutineData } from "../routine/types";
import { chronotypeFor, peakWindowFor } from "./energy";
import { isSuggested, rankCandidates } from "./planMeta";
import { shiftFutureEvents, restoreShift, type ShiftResult } from "./runningLate";
import {
  moveEvent as moveEventAdjust, undoMoveEvent as undoMoveEventAdjust, type MoveOutcome,
  resizeEvent as resizeEventAdjust, undoResizeEvent as undoResizeEventAdjust, type ResizeOutcome,
  skipEventToday as skipEventTodayAdjust, undoSkipEventToday as undoSkipEventTodayAdjust,
  pushEventTomorrow as pushEventTomorrowAdjust, undoPushEventTomorrow as undoPushEventTomorrowAdjust, type PushOutcome,
} from "./eventAdjust";
import { shiftBlock as shiftBlockAdjust, blockShiftFits, retimeBlock as retimeBlockAdjust, resizeBlock as resizeBlockAdjust, editBlockBasics, removeBlock as removeBlockAdjust } from "../routine/blockAdjust";
import { useAI } from "../ai/useAI";
import { useAIContext } from "../ai/useAIContext";
import { contextToText } from "../ai/context";
import type { TaskItem } from "../tasks/TasksService";
import { repeatRows } from "./repeats";
import { overlapsOn, overlapLine, copyDay, durationOf, type Overlap } from "./dayEdit";
import { capAfterNumber } from "../shared/casing";
import { useFreshLists } from "../data/useFreshLists";
import { ENTITY_EVENT } from "./types";
import { ENTITY_TASK } from "../notes/types";
import { moveEventToAnytime, undoMoveToAnytime, duplicateEvent as duplicateEventMove } from "./eventMoves";

// SCHED-F-03 (2026-09-05): an edit is of ONE OCCURRENCE, so the sheet state
// carries which day was tapped. Without it "This Event" split the day that
// happened to be selected while the sheet showed, and saved to, the series
// anchor.
type SheetState = { mode: "new" } | { mode: "edit"; id: string; occurrence: string; initial: EventDraft; source?: import("../shared/provenance").Source } | null;

export default function ScheduleFlow({ onEditRoutine, openId, onNavigate }: { onEditRoutine?: (blockId?: string) => void; openId?: string; onNavigate?: (kind: string, id: string) => void } = {}) {
  // UP-CORE-05 (2026-09-05): one map from a provenance stamp to a route,
  // shared with every other surface that shows the line (shared/openSource).
  const openSourceFor = useMemo(() => (onNavigate ? sourceOpener(onNavigate) : undefined), [onNavigate]);
  const svc = useSchedule();
  const rulesSvc = useOptionalRules();
  // The chosen day cap (monthly report's one change): seeds the sheet.
  // S4-Q26 (2026-09-04): read through the rules list, not the profile
  // field, so deleting the row in What JARVIS Learned genuinely un-caps
  // the day.
  const [planCap, setPlanCap] = useState<number | undefined>(undefined);
  useEffect(() => {
    let on = true;
    rulesSvc?.resolve("plan.cap", "day").then(async (r) => {
      // create() pre-announces, so this is a no-op in the normal case; see
      // that method's comment for why a second, generic announcement here
      // would say less than the toast already shown at creation.
      if (r) await rulesSvc.announceIfFirstUse(r);
      if (on) setPlanCap(r ? Number(r.data.to) || undefined : undefined);
    }).catch(() => {});
    return () => { on = false; };
  }, [rulesSvc]);
  // UP-CORE-07 (2026-09-05): the travel times already typed, keyed by place.
  // On the profile so they sync, and read once here for the sheet to prefill
  // from. Never in the Brain: no place is learned, nothing is inferred.
  const profileSvc = useProfile();
  const [travelMemory, setTravelMemory] = useState<TravelMemory>({});
  useEffect(() => {
    let on = true;
    profileSvc.get().then((p) => { if (on) setTravelMemory(p?.travel ?? {}); }).catch(() => {});
    return () => { on = false; };
  }, [profileSvc]);
  // The place's minutes are remembered on save, and the Forget row empties
  // them. One writer, called from both save paths.
  const rememberPlace = async (location: string, minutes: number | null, forget: boolean) => {
    const next = rememberTravel(travelMemory, location, forget ? null : minutes);
    if (!next) return;
    setTravelMemory(next);
    try { await profileSvc.save({ travel: next }); } catch { /* the event still saved; the memory is a convenience */ }
  };

  // UP-CORE-08 (2026-09-05): which of the day's events already have a note.
  // ONE read per day, not one per row: notesLinkedTo scans the note list, so
  // asking it per row would scan it per row.
  const notesSvc = useNotes();
  const [notedEvents, setNotedEvents] = useState<ReadonlySet<string>>(new Set());
  const [noteTick, setNoteTick] = useState(0);
  const cats = useCategories();
  const today = todayISO();
  const t0 = new Date(today + "T00:00:00");
  const [view, setView] = useState({ y: t0.getFullYear(), m: t0.getMonth() });
  const [selected, setSelected] = useState(today);
  const [dots, setDots] = useState<Record<number, string[]>>({});
  const [dayEvents, setDayEvents] = useState<EventItem[]>([]);
  useEffect(() => {
    let on = true;
    const ids = dayEvents.map((e) => e.id);
    notesSvc.eventsWithNotes(ids).then((set) => { if (on) setNotedEvents(set); }).catch(() => {});
    return () => { on = false; };
  }, [notesSvc, dayEvents, noteTick]);

  // The meeting's own page: made titled and linked the first time, opened
  // every time after. onNavigate is the shell's route to a note, the same one
  // a provenance line uses.
  const openEventNote = async (e: EventItem) => {
    const existing = await notesSvc.notesLinkedTo(e.id);
    if (existing[0]) { onNavigate?.("note", existing[0].id); return; }
    let noteId: string | null = null;
    const ok = await attemptWrite(async () => {
      noteId = await notesSvc.createForEvent({ id: e.id, title: e.data.title, date: selected, category: e.data.category });
    });
    setNoteTick((n) => n + 1);
    if (ok && noteId) onNavigate?.("note", noteId);
  };

  const [categories, setCategories] = useState<SheetCategory[]>([]);
  const [pausedCats, setPausedCats] = useState<ReadonlySet<string>>(new Set());
  const [catsFull, setCatsFull] = useState<Category[]>([]);
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const [projList, setProjList] = useState<Project[]>([]);
  const [goalList, setGoalList] = useState<Goal[]>([]);
  useEffect(() => {
    let on = true;
    Promise.all([projectsSvc.list(), goalsSvc.list()]).then(([p, g]) => { if (on) { setProjList(p); setGoalList(g); } });
    return () => { on = false; };
  }, [projectsSvc, goalsSvc]);
  const [sheet, setSheet] = useState<SheetState>(null);
  // THE SAME TAP AS AN EVENT (2026-08-28, Dave: "when I click on something in
  // the schedule it should allow me to edit it like a normal scheduled
  // event"). Tapping a protected block used to open the whole Your Routine
  // screen. This is its own small sheet state, same shape as `sheet` above,
  // so a tap opens a short form instead of leaving the screen.
  const [blockSheet, setBlockSheet] = useState<{ id: string; initial: BlockDraft } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // SCHEDULE AUDIT 2026-08-29: opens on DAY, not month. The tab's whole
  // day machinery -- the timeline, gaps, proposals, Accept, scroll-to-now
  // (which is day-mode-gated) -- answers "what is my day", and the month
  // grid answers "what is my month", which is the browsing question, not
  // the landing one. Landing on month meant the most-used view was always
  // one extra tap away and the scroll-to-next-event never fired on arrival.
  const [mode, setMode] = useState<"day" | "week" | "month" | "repeats">("day");
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const tasksSvc = useTasks();
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  // ONE SCHEDULE (blend, 2026-08-22). The standing proposal for the selected
  // date is drawn among this day's real rows, editable here exactly as on
  // Today, over the SAME stored draft.
  const [proposalDraft, setProposalDraft] = useState(() => readDraft(todayISO()));
  const [tuning, setTuning] = useState<string | null>(null);
  const ai = useAI();
  // Brain Personalization Phase 1 (2026-08-06): the same assembled context
  // every other AI feature already reads (Life Philosophy, Values, How You
  // Write, habits, completion patterns, etc.), now also reaching the day
  // planner instead of it reasoning from work hours and energy alone.
  const gatherContext = useAIContext();
  const routine = useRoutine();
  const strandsSvc = useOptionalStrands();
  const [routineData, setRoutineData] = useState<RoutineData>(DEFAULT_ROUTINE);
  const [routineSet, setRoutineSet] = useState(true);
  const [loading, setLoading] = useState(true);
  // SCHED-F-14 (2026-09-05): the last reload failed. The page renders what it
  // has and a quiet row says so, with the retry on it.
  const [loadFailed, setLoadFailed] = useState(false);
  const [newStart, setNewStart] = useState<string | null>(null);
  // THE TRAINING DOOR (D4-C). The gym's programs and history, read only so a
  // door event can name the day's lift and price it -- and the overlay that
  // opens when the athlete walks through.
  const gymSvc = useOptionalGym();
  const [gymData, setGymData] = useState<{ programs: Program[]; workouts: Workout[] } | null>(null);
  const [gymDoorOpen, setGymDoorOpen] = useState<{ eventId: string; budgetMin?: number } | null>(null);
  // Soft anchor guard (roadmap v2): the one gentle nudge, at most once per day.
  const [guard, setGuard] = useState<{ id: string; date: string } | null>(null);
  const nudgedDays = useRef<Set<string>>(new Set());

  // SCHED-F-14 (2026-09-05): four awaits that can each throw sat in front of
  // setLoading(false) with no catch, and the mount effect dropped the
  // rejection, so a cold start with no preload cache and no signal (or an
  // RLS or token error) showed SkeletonRows for good with no message; the
  // per-tab error boundary does not see a rejected promise. Loading now
  // clears either way and a failure is a row on the page, not silence.
  const reload = useCallback(async () => {
    setProposalDraft(readDraft(selected));
    try {
      // Self-healing dedupe (hotfix 2026-08-21): a task never keeps two plan
      // events on the viewed day. Runs on what this read actually sees, so a
      // cold read heals nothing rather than deleting on absence.
      const d = new Date();
      const healNow = selected === todayISO() ? d.getHours() * 60 + d.getMinutes() : null;
      await svc.healPlanDuplicates(selected, healNow);
      setDots(await svc.daysWithEvents(view.y, view.m));
      setDayEvents(await svc.eventsOn(selected));
      setAllEvents(await svc.listEvents());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [svc, view.y, view.m, selected]);

  useEffect(() => {
    reload();
  }, [reload]);
  // A background refresh that found real changes repaints this surface
  // (2026-08-24). CachedAdapter has reported these since it shipped and
  // nothing was listening, so a day edited on another device sat wrong until
  // something else happened to trigger a reload. Events only here; the task
  // refresh has its own reloader below (SCHED-F-16).
  useFreshLists([ENTITY_EVENT], reload);


  useEffect(() => {
    let on = true;
    tasksSvc.listTasks().then((t) => { if (on) setTaskItems(t); });
    return () => { on = false; };
  }, [tasksSvc, planOpen]);

  useEffect(() => {
    let on = true;
    routine.get().then((r) => { if (on) setRoutineData(r); });
    routine.isConfigured().then((c) => { if (on) setRoutineSet(c); });
    return () => { on = false; };
  }, [routine]);

  useEffect(() => {
    let on = true;
    cats.list().then((list) => {
      if (!on) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color })));
      setPausedCats(pausedCategoryIds(list));
      setCatsFull(list);
    });
    return () => { on = false; };
  }, [cats]);

  const stepMonth = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  const syncView = (iso: string) => { const d = new Date(iso + "T00:00:00"); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const onPrev = () => {
    if (mode === "month") stepMonth(-1);
    else { const next = addDays(selected, mode === "week" ? -7 : -1); setSelected(next); syncView(next); }
  };
  const onNext = () => {
    if (mode === "month") stepMonth(1);
    else { const next = addDays(selected, mode === "week" ? 7 : 1); setSelected(next); syncView(next); }
  };

  // ONE OVERLAP MODEL (hotfix 2026-08-21): the badges, the collide card, and
  // the clash count all read this same pair list, minus the pairs Dave has
  // deliberately kept, so no two surfaces can tell different stories about
  // the same day. Container blocks (focus, protected) are routine ranges,
  // not events, and are never collision partners here.
  const dayOverlaps = overlapsOn(allEvents, selected).filter((o) => !isKept(o, selected));
  const conflicts = new Set<string>(dayOverlaps.flatMap((o) => [o.a.id, o.b.id]));
  const [fixing, setFixing] = useState<Overlap | null>(null);
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const checkConflict = (date: string, startT: string, endT: string) => {
    const others = eventsForDate(allEvents, date).filter((e) => !(sheet && sheet.mode === "edit" && e.id === sheet.id));
    const s = toMin(startT), en = endT ? toMin(endT) : s + 60;
    return others.some((e) => { const es = toMin(e.data.start), ee = e.data.end ? toMin(e.data.end) : es + 60; return s < ee && es < en; });
  };

  // PICK 23: one upward index per render pass, the same shape Today builds.
  const goalIdx = buildGoalIndex(projList, liveGoals(goalList));
  const parentIdx = useMemo(() => buildParentIndex(projList, goalList, taskItems), [projList, goalList, taskItems]);
  const realToday = todayISO();
  const plannedTaskIds = new Set(dayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x));
  const planCandidates = taskItems
    // A reminder is not a task (catalog Q1): never a plan candidate.
    .filter((t) => !t.data.done && !t.data.reminder && !plannedTaskIds.has(t.id) && (!t.data.due || (t.data.due as string) <= selected))
    // Season pause: paused categories are not offered; bills are exempt.
    .filter((t) => !pausedCats.has(t.data.category ?? "") || !!t.data.bill)
    .map((t) => {
      const due = (t.data.due as string) || "";
      const win = workWindowOf(catsFull, t.data.category, routineData);
      return {
        id: t.id, text: t.data.text, category: t.data.category ?? "", due,
        suggested: isSuggested(due, selected, t.data.recurrence), overdue: !!due && due < realToday,
        // PICK 23: the same upward index Today uses, so the two surfaces
        // that both build plan candidates cannot rank them differently.
        goal: goalTitleForTask(goalIdx, t),
        ...(win ? { windowS: win.s, windowE: win.e } : {}),
      };
    })
    .sort(rankCandidates);
  const planDow = (() => { const p = selected.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay(); })();
  const planWindow = planWindowFor(routineData, planDow);
  const planStart = selected === todayISO()
    ? (() => { const d = new Date(); const now = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15; return Math.max(now, planWindow.wakeMin); })()
    : planWindow.wakeMin;
  const planEnd = planWindow.endMin;
  // Phase 2: protected ranges and the inferred energy peak for the selected
  // day. Mood sizing is a Today-surface behavior, so it is not applied here.
  const blocked = protectedRangesFor(routineData, planDow);
  const chrono = chronotypeFor(routineData);
  const peak = peakWindowFor(routineData, chrono);
  const energy = chrono !== "neutral" ? { chronotype: chrono, peakStartMin: peak.s, peakEndMin: peak.e } : undefined;
  // The proposal for the day being LOOKED AT. A draft is stored per date, so
  // browsing to another day simply finds none, which is the honest answer.
  const standingDraft = proposalDraft && proposalDraft.date === selected
    && !proposalDraft.accepted && !proposalDraft.dismissed && proposalDraft.blocks.length > 0
    ? proposalDraft : null;
  // SCHEDULE AUDIT 2026-08-29: the live view of the standing draft. Blocks
  // whose task the day has already answered (a committed event with its
  // sourceTaskId -- a Start Fifteen block, a sheet commit), or whose task is
  // done or gone, do not render and do not commit. See liveBlocks() for why
  // the STORED draft is left alone.
  const liveDraftBlocks = standingDraft ? liveBlocks(standingDraft.blocks, dayEvents, taskItems) : [];

  const applyProposalEdit = (op: { minutes?: Record<string, number>; drop?: string; add?: string }) => {
    setProposalDraft((cur) => {
      if (!cur) return cur;
      const ids = cur.blocks.map((b) => b.taskId);
      const m = (hhmm: string) => { const q = hhmm.split(":"); return Number(q[0] ?? 0) * 60 + Number(q[1] ?? 0); };
      const minutes: Record<string, number> = {};
      for (const b of cur.blocks) minutes[b.taskId] = m(b.end) - m(b.start);
      let next = ids;
      if (op.drop) next = ids.filter((id) => id !== op.drop);
      if (op.add && !ids.includes(op.add)) next = [...ids, op.add];
      Object.assign(minutes, op.minutes ?? {});
      const edited = editDraft(cur, {
        ids: next, minutes,
        pool: planCandidates.map((c) => ({ id: c.id, text: c.text, category: c.category })),
        events: dayEvents,
        startMin: planStart,
        endMin: planEnd,
        blocked,
        estimateFor: () => 45,
      });
      writeDraft(edited);
      return edited;
    });
  };

  // ACCEPT, FROM HERE TOO. Same write door as Today (commitPlan sweeps a
  // task's prior block before writing), same resolution (acceptInto marks
  // the one draft), so which tab he was looking at cannot change what the
  // day becomes.
  // B12 (2026-08-23): FIRES EXACTLY ONCE.
  //
  // commitPlan creates one event per block, so two taps landing before the
  // first write resolves produced a full duplicate day. There was no
  // disabled state and no label change, and on a phone the button sits
  // exactly where an impatient thumb taps twice.
  //
  // A ref, not state, and deliberately: a state flag re-renders and the
  // second tap can still enter before React commits it. This is the same
  // guard UpNextFlow uses on its completion path, for the same reason.
  const accepting = useRef(false);
  const acceptProposal = async () => {
    if (!standingDraft || liveDraftBlocks.length === 0 || accepting.current) return;
    accepting.current = true;
    try {
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await svc.commitPlan(selected, liveDraftBlocks.map((b) => ({
        taskId: b.taskId, text: b.text, category: b.category, start: b.start, end: b.end,
        // Accepting the card IS committing a day plan: the picks ride the
        // same event door as a hand-built one (audit 2026-08-25). Block
        // order is the card's own order.
      })), undefined, { picks: liveDraftBlocks.map((b) => b.taskId) })).created;
    });
    if (!ok) return;
    const resolved = acceptInto(readDraft(selected), selected, liveDraftBlocks, ids);
    if (resolved) { writeDraft(resolved); setProposalDraft(resolved); }
    setTuning(null);
    await reload();
    showToast({
      message: `Planned ${liveDraftBlocks.length} ${liveDraftBlocks.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { for (const id of ids) await svc.deleteEvent(id); }); await reload(); },
    });
    } finally {
      accepting.current = false;
    }
  };

  const dismissProposal = () => {
    if (!standingDraft) return;
    const next = { ...standingDraft, dismissed: true };
    writeDraft(next);
    setProposalDraft(next);
    setTuning(null);
  };

  const proposalFooter = standingDraft && liveDraftBlocks.length > 0 ? (
    <div className="day-foot">
      <button className="btn btn-primary btn-sm" onClick={() => void acceptProposal()}>Accept the Day</button>
      {/* SCHEDULE AUDIT 2026-08-29: bare .btn-sm is press-3 with
          `color: var(--tint)` -- red TEXT -- and this one sits directly
          beside the red-filled Accept. Two reds of equal weight arguing
          about which one you meant, the same bug Just This One had on
          Tasks. btn-secondary is the identical pill with neutral text; the
          .btn-sm:not(.btn-secondary) guard in components.css exists
          precisely so this class combination keeps the small sizing. */}
        <button className="btn btn-sm btn-secondary" onClick={dismissProposal}>Not Today</button>
    </div>
  ) : null;

  const standingProposal = standingDraft && liveDraftBlocks.length > 0 ? {
    blocks: liveDraftBlocks,
    openId: tuning,
    onToggle: (id: string) => setTuning((t) => (t === id ? null : id)),
    onDuration: (id: string, minutes: number) => applyProposalEdit({ minutes: { [id]: minutes } }),
    onDrop: (id: string) => { setTuning(null); applyProposalEdit({ drop: id }); },
  } : undefined;

  const onAIPlan = ai.available
    ? async (picks: { id: string; text: string; category: string; overdue: boolean }[], s: number, e: number, background: boolean) => {
        const ctx = await gatherContext();
        // Strands ride with their real ids so the model can HONESTLY say
        // which fact changed the plan (item 04 attribution). Best-effort.
        // Strength rides along too (S4-Q24), so planDayUserMessage can split
        // a user-declared rule from an ordinary influence instead of
        // rendering every strand as one equally-weighted list.
        let strandList: { id: string; text: string; strength?: "influence" | "rule" }[] = [];
        try {
          strandList = strandsSvc ? (await strandsSvc.active()).map((x) => ({ id: x.id, text: x.data.text, strength: x.data.strength })) : [];
        } catch { /* a plan without attribution beats no plan */ }
        return aiPlanDay(ai, picks, dayEvents, s, e, {
          work: { startMin: routineData.workStartMin, endMin: routineData.workEndMin },
          energy,
          profile: contextToText(ctx),
          strands: strandList,
          background,
        });
      }
    : undefined;
  const onPlanCommit = async (blocks: { taskId: string; text: string; category: string; start: string; end: string; sitting?: number }[], picks: string[]) => {
    // Replace, never add (hotfix 2026-08-21): commitPlan sweeps each task's
    // prior plan event on this day before writing, against a fresh read.
    let ids: string[] = [];
    const ok = await attemptWrite(async () => {
      ids = (await svc.commitPlan(selected, blocks, undefined, { picks })).created;
    });
    // ONE PROPOSED DAY (merge phase 1). Schedule commits through the same
    // door, so it resolves the same standing draft; otherwise Today would
    // still be showing a card for a day this tab has already written.
    if (ok) {
      const resolved = acceptInto(readDraft(selected), selected, blocks, ids);
      if (resolved) { writeDraft(resolved); setProposalDraft(resolved); }
    }
    setPlanOpen(false);
    await reload();
    if (!ok) return;
    showToast({
      message: `Planned ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { for (const id of ids) await svc.deleteEvent(id); }); await reload(); },
    });
  };

  const suggestSlot = (date: string) => {
    const exclude = sheet && sheet.mode === "edit" ? sheet.id : null;
    return nextFreeSlot(allEvents.filter((e) => e.id !== exclude), date, new Date());
  };

  // THE WEEK (D2): seven rows from the same window and open-slot rule the
  // Day view uses. Sorted by the flow, painted by the page.
  const weekRows = weekRowsFor(weekOf(selected), allEvents, routineData, { date: today, nowMin: (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })() });
  const weekCells = weekOf(selected).map((date) => {
    const evs = eventsForDate(allEvents, date);
    const day = new Date(date + "T00:00:00").getDate();
    const colors = Array.from(new Set(evs.map((e) => e.data.category))).slice(0, 3);
    return { date, day, colors };
  });

  // SCHED-F-03 (2026-09-05): the occurrence that was tapped, not the record's
  // anchor date. A weekly event opened from Thursday used to seed the sheet
  // with the series' own start date (ScheduleFlow.tsx:429-436 in the audit),
  // so the Date field named a day he was not looking at and "This Event"
  // dropped its split there. Row taps pass the day they render; a tap with no
  // day behind it (the Repeats list, a connection, the attach follow-up)
  // resolves to the next occurrence from today, which is the one a person
  // means by "this event" when no day is on screen.
  const openEdit = async (id: string, occurrenceDate?: string) => {
    const e = await svc.event(id);
    if (!e) return;
    const repeating = (e.recurrence ?? "none") !== "none";
    const occurrence = occurrenceDate ?? (repeating ? nextOccurrence(e, todayISO()) ?? e.date : e.date);
    // Use the occurrence's date, not the currently selected day: editing an
    // event from another day must not silently move it to the selected date.
    // B1-2 (2026-09-04): "until" has to travel into the sheet too, or the
    // sheet's own default of "" reads as "forever" and onSave below writes
    // that back, silently erasing a real end date on any unrelated edit.
    setSheet({ mode: "edit", id, occurrence, source: rowSource(e.source, e.moved), initial: { title: e.title, date: occurrence, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none", until: e.until ?? "", taskIds: e.taskIds ?? [], gym: !!e.gym, travelMin: e.travelMin ?? null, bufferMin: e.bufferMin ?? null } });
  };

  // When arriving via a note connection, jump to the event's own date and open
  // it once on mount. Uses the event's real date, not the current selection.
  useEffect(() => {
    if (!openId) return;
    let on = true;
    (async () => {
      const e = await svc.event(openId);
      if (!on || !e) return;
      // SCHED-F-03: a series arrived at from a note opens on the day it next
      // happens, and the tab lands there, so the sheet and the list agree.
      const repeating = (e.recurrence ?? "none") !== "none";
      const occurrence = repeating ? nextOccurrence(e, todayISO()) ?? e.date : e.date;
      setSelected(occurrence);
      syncView(occurrence);
      setSheet({ mode: "edit", id: openId, occurrence, source: rowSource(e.source, e.moved), initial: { title: e.title, date: occurrence, start: e.start, end: e.end ?? "", category: e.category ?? "", location: e.location ?? "", recurrence: e.recurrence ?? "none", until: e.until ?? "", taskIds: e.taskIds ?? [], gym: !!e.gym, travelMin: e.travelMin ?? null, bufferMin: e.bufferMin ?? null } });
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // SCHED-F-09 (2026-09-05): Undo puts the WHOLE event back, under its own
  // id. The hand-listed opts here dropped the series end, the skipped days,
  // the attached tasks, the Training Door and its receipts, so undoing a
  // deleted gym block gave back a block that was no longer the door and ran
  // forever.
  const offerUndoEvent = (e: EventData, id: string) => {
    showToast({
      message: "Event deleted",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.recreateFrom(e, id));
        await reload();
      },
    });
  };

  const onSave = async (draft: EventDraft, scope?: "this" | "series") => {
    let newEventId: string | null = null;
    let newEventDate: string | null = null;
    if (sheet?.mode === "new") {
      const created = await attemptWrite(async () => {
        newEventId = await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, recurrence: draft.recurrence, until: draft.until || undefined, taskIds: draft.taskIds, travelMin: draft.travelMin ?? undefined, bufferMin: draft.bufferMin ?? undefined });
        if (newEventId && draft.gym) await svc.editGymDoor(newEventId, true);
      });
      if (!created) newEventId = null;
      newEventDate = draft.date;
    } else if (sheet?.mode === "edit") {
      const id = sheet.id;
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        // Split one occurrence off the series into a standalone event.
        // SCHED-F-03 (2026-09-05): the occurrence the sheet was opened on,
        // never the selected day. The exdate and the copy have to name the
        // same occurrence or the tapped day keeps the series copy and a
        // duplicate lands on some other day.
        await attemptWrite(async () => {
          await svc.addExdate(id, sheet.occurrence);
          const splitId = await svc.createEvent(draft.title, { date: draft.date, start: draft.start, end: draft.end || undefined, category: draft.category || undefined, location: draft.location || undefined, travelMin: draft.travelMin ?? undefined, bufferMin: draft.bufferMin ?? undefined });
          if (splitId && draft.gym) await svc.editGymDoor(splitId, true);
        });
      } else {
        await attemptWrite(async () => {
          await svc.editTitle(id, draft.title);
          if (!recurring) await svc.moveDay(id, draft.date);
          // SCHED-F-11 (2026-09-05): All Events plus a new date MOVES THE
          // SERIES. Tapping Tomorrow on a weekly series and saving used to do
          // nothing at all, with no message (:489, `if (!recurring)`). The
          // whole series slides by the number of days the occurrence moved,
          // which is what changes the anchor and therefore every occurrence.
          else if (draft.date !== sheet.occurrence) {
            const cur = await svc.event(id);
            if (cur) await svc.moveDay(id, addDays(cur.date, daysBetween(sheet.occurrence, draft.date)));
          }
          await svc.editTime(id, draft.start);
          await svc.editEnd(id, draft.end);
          await svc.editRecurrence(id, draft.recurrence);
          await svc.editUntil(id, draft.until || null);
          await svc.editCategory(id, draft.category);
          await svc.editLocation(id, draft.location);
          await svc.editTravel(id, draft.travelMin ?? null, draft.bufferMin ?? null);
          await svc.editTaskIds(id, draft.taskIds ?? []);
          await svc.editGymDoor(id, !!draft.gym);
        });
      }
    }
    // UP-CORE-07: the place's minutes are typed once and offered every time
    // after. Outside attemptWrite: the event itself is what a failure here
    // must not take down.
    if (draft.location.trim()) await rememberPlace(draft.location, draft.travelMin ?? null, !!draft.forgetTravel);
    setSheet(null);
    setNewStart(null);
    await reload();
    if (newEventId && newEventDate) {
      const guarded = await maybeAnchorGuard(newEventDate, newEventId);
      // Memory layer: third same-weekday in a row -> offer to make it repeat.
      // One nudge at a time (the guard wins), asked once (only at exactly 3),
      // and never applied silently.
      if (!guarded) {
        const cand = repeatCandidate(allEvents, { title: draft.title, date: newEventDate, recurrence: draft.recurrence });
        if (cand && cand.count === 3) {
          const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const evId = newEventId;
          showToast({
            message: `Third ${WD[cand.weekday]} running · Repeat weekly?`,
            actionLabel: "Make It Repeat",
            onAction: async () => { await attemptWrite(() => svc.editRecurrence(evId, "weekly")); await reload(); },
          });
        }
      }
    }
  };

  // BULK DELETE FOR A DAY (Dave 2026-08-24). Snapshots first, or Undo has
  // nothing to put back.
  //
  // A repeating event is deleted as the SERIES here, not as one day, and the
  // toast says so. Every other quiet path in this flow moves a single
  // occurrence precisely because touching a series by accident is the
  // footgun; a selection is not an accident, but it is also not the place to
  // ask six separate questions about scope, so the honest answer is to say
  // plainly what happened and offer the way back.
  const onDeleteManyEvents = async (ids: string[]) => {
    if (ids.length === 0) return;
    // SCHED-F-09: the snapshot keeps each event's id, so Undo brings the same
    // records back rather than lookalikes with new ids.
    const kept: { id: string; data: EventData }[] = [];
    for (const id of ids) {
      const e = await svc.event(id);
      if (e) kept.push({ id, data: e });
    }
    let gone = 0;
    await attemptWrite(async () => { for (const id of ids) { await svc.deleteEvent(id); gone++; } });
    await reload();
    if (gone === 0) return;
    const n = gone;
    const repeats = kept.slice(0, n).filter((e) => (e.data.recurrence ?? "none") !== "none").length;
    showToast({
      message: (n === 1 ? "Event deleted" : n + " events deleted")
        + (repeats > 0 ? " \u00b7 " + (repeats === 1 ? "1 was a repeat" : repeats + " were repeats") : ""),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          for (const e of kept.slice(0, n)) await svc.recreateFrom(e.data, e.id);
        });
        await reload();
      },
    });
  };

  const onDelete = async (scope?: "this" | "series") => {
    if (sheet?.mode === "edit") {
      const recurring = (sheet.initial.recurrence ?? "none") !== "none";
      if (recurring && scope === "this") {
        // SCHED-F-03: the occurrence that was opened, not the selected day.
        await attemptWrite(() => svc.addExdate(sheet.id, sheet.occurrence));
      } else {
        const e = await svc.event(sheet.id);
        const deletedId = sheet.id;
        const ok = await attemptWrite(() => svc.deleteEvent(deletedId));
        if (ok && e) offerUndoEvent(e, deletedId);
      }
    }
    setSheet(null);
    setNewStart(null);
    await reload();
  };

  const onPickSlot = (start: string) => { setNewStart(start); setSheet({ mode: "new" }); };

  // --- Session 4 connections: attachments + the event-end follow-up ---
  // SCHED-F-10 (2026-09-05): ONLY A ONE-OFF HOLDS TASKS. The rule is the
  // sheet's (EventSheet.tsx:144, "links live on the event and die with it; a
  // whole series sharing one link list is a footgun"), and it is enforced
  // here as well, on the surface that OFFERS the attach. Anything already on
  // a series from before is not counted either, because the sheet hides it
  // and wipes it on the next save: a row claiming "1 task attached" that the
  // editor then denies is the same fact told two ways.
  const holdsTasks = (e: EventItem) => (e.data.recurrence ?? "none") === "none";
  const attachMap: Record<string, AttachInfo> = {};
  // S6-Q36: same per-event lookup as attachMap, alongside it.
  const firstMoveMap: Record<string, string> = {};
  for (const e of dayEvents) {
    const info = holdsTasks(e) ? attachInfo(e, taskItems) : null;
    if (info) attachMap[e.id] = info;
    const move = firstMoveOf(e, taskItems);
    if (move) firstMoveMap[e.id] = move;
  }
  const attachableTasks = taskItems
    .filter((t) => !t.data.done || dayEvents.some((e) => holdsTasks(e) && e.data.taskIds?.includes(t.id)))
    .map((t) => ({ id: t.id, text: t.data.text, category: t.data.category ?? "", done: t.data.done, due: t.data.due ?? null, projectId: t.data.projectId }));
  const onToggleAttached = async (id: string) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reloadTasks(); };

  // BLENDING (Dave, 2026-08-21). Attaching a task to a block already worked;
  // it was just buried six fields deep in an editor. The offer now comes to
  // the block, on the day list, one tap, no sheet.
  //
  // Only ONE offer per block and only when it is clearly the best fit. A
  // suggestion that is a coin flip between two tasks is worse than silence,
  // because tapping it stops being a shortcut and starts being a gamble.
  const blendMem = loadBlendMemory();
  const blendTap = async (e: EventItem, taskId: string, categoryId: string) => {
    const prior = e.data.taskIds ?? [];
    const ok = await attemptWrite(() => svc.editTaskIds(e.id, [...prior, taskId]));
    if (!ok) return;
    // The vote is only cast when the blend actually lands. Learning from an
    // attach that failed to write would teach the app a habit he never had.
    recordBlend(blockKind(e.data), categoryId);
    await reload();
    showToast({
      message: "Added to " + e.data.title,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.editTaskIds(e.id, prior));
        await reload();
      },
    });
  };
  const blendMap: Record<string, { text: string; why: string; onAdd: () => void }> = {};
  {
    // A block that already holds something is not asking for more. One
    // suggestion at a time, or the day list turns into a second to-do list.
    // SCHED-F-10: and a repeating block is never asking, because it cannot
    // hold a task at all. The tuck used to appear under a weekly commute,
    // attach on every week's copy, and be wiped by the next save.
    const open = dayEvents.filter((e) => holdsTasks(e) && (e.data.taskIds ?? []).length === 0);
    const byEvent = bestPerBlock(open, attachableTasks, blendMem);
    for (const e of open) {
      const fit = byEvent[e.id];
      if (!fit) continue;
      blendMap[e.id] = {
        text: fit.task.text,
        why: fit.why,
        onAdd: () => { void blendTap(e, fit.task.id, fit.task.category); },
      };
    }
  }

  // "N tasks were attached. Any done?": once per event, ever. Asked ids live in
  // localStorage so the question never comes back.
  const ASKED_KEY = "jarvis.attach.asked";
  const readAsked = (): string[] => { try { const v = JSON.parse(localStorage.getItem(ASKED_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
  const followUpBusy = useRef(false);
  useEffect(() => {
    if (loading || selected !== today || followUpBusy.current) return;
    const asked = readAsked();
    const cand = followUpCandidate(allEvents, taskItems, today, nowHHMM, new Set(asked));
    if (!cand) return;
    followUpBusy.current = true;
    try { localStorage.setItem(ASKED_KEY, JSON.stringify([...asked, cand.eventId].slice(-200))); } catch { /* private mode */ }
    showToast({
      message: `${cand.title} · ${cand.openCount} attached ${cand.openCount === 1 ? "task" : "tasks"} · Any done?`,
      actionLabel: "Review",
      onAction: () => { followUpBusy.current = false; openEdit(cand.eventId); },
    });
    // One question at a time: the next candidate (if any) waits half a minute.
    setTimeout(() => { followUpBusy.current = false; }, 30000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selected, allEvents, taskItems]);

  // --- Roadmap v2 Anytime row ---
  // Tasks with no time for the selected day, shown as a strip above the grid.
  const reloadTasks = useCallback(async () => { setTaskItems(await tasksSvc.listTasks()); }, [tasksSvc]);
  // SCHED-F-16 (2026-09-05): the task subscription used to point at `reload`,
  // which refreshes events only, so a task completed on the iPad stayed under
  // Anytime on the phone until Plan My Day opened. Fresh tasks re-read tasks.
  useFreshLists([ENTITY_TASK], reloadTasks);
  const anytimeItems = mode === "day"
    // SCHED-F-06 (2026-09-05): the same two carve-outs planCandidates makes
    // above, now made by the strip's own builder: no reminders, and nothing
    // from a paused category except a bill.
    ? anytimeTasksForDay(taskItems, dayEvents, selected, draftClaims(standingDraft), pausedCats)
    : [];

  // Tap the circle: complete the task (it leaves the strip).
  // Make a task from inside the planner, due on the day being planned.
  const addPlanTask = async (text: string) => {
    let made: string | null = null;
    const ok = await attemptWrite(async () => { made = await tasksSvc.createTask(text, { due: selected }); });
    if (!ok || !made) return null;
    await reloadTasks();
    return { id: made as string, text, category: "", suggested: false, overdue: false, due: selected };
  };

  const onToggleTask = async (id: string) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reloadTasks(); };

  // Give-back: move a timed block back to Anytime. If it came from a task the
  // task still exists, so deleting the block returns it to the strip; a manual
  // event becomes a fresh task first. Undo restores the block either way.
  const onUnschedule = async (id: string) => {
    // The move itself is in schedule/eventMoves.ts so Today can make it too.
    type MoveRes = Awaited<ReturnType<typeof moveEventToAnytime>>;
    let res: MoveRes | null = null;
    const ok = await attemptWrite(async () => { res = await moveEventToAnytime(id, svc, tasksSvc); });
    await reload();
    await reloadTasks();
    const r = res as MoveRes | null;
    if (!ok || !r?.ok || !r.event) return;
    const kept = r.event;
    const keptId = r.eventId;
    const madeTaskId = r.madeTaskId;
    showToast({
      message: "Moved to Anytime",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => undoMoveToAnytime(kept, madeTaskId, svc, tasksSvc, keptId));
        await reload(); await reloadTasks();
      },
    });
  };

  // The nudge: at most once per day, when a manual/tapped add reaches a 4th
  // timed item. Plan My Day is exempt (it schedules on purpose).
  const maybeAnchorGuard = async (date: string, newId: string): Promise<boolean> => {
    if (nudgedDays.current.has(date)) return false;
    if ((await svc.countOn(date)) >= 4) { nudgedDays.current.add(date); setGuard({ id: newId, date }); return true; }
    return false;
  };

  // Tap the name: give the task a time. Drops a 60-minute block at the next open
  // slot, carrying the task id so the strip and grid stay in sync. Undo removes it.
  const onScheduleTask = async (id: string, droppedAt?: string) => {
    const t = await tasksSvc.task(id);
    if (!t) return;
    // C3 (audit 2026-08-21): a drag that ignores WHERE you dropped is a
    // long-winded way to press a button. When the finger landed on real open
    // time, that IS the answer and the planner does not get a vote.
    if (droppedAt) {
      const okDrop = await attemptWrite(() => svc.commitPlan(selected, [{
        taskId: id, text: t.text, category: t.category ?? "",
        start: droppedAt, end: addMinutes(droppedAt, 60),
      }]));
      await reload();
      if (okDrop) showToast({ message: `Scheduled ${fmtTime(droppedAt).time}${fmtTime(droppedAt).ap}` });
      return;
    }
    // Land the block through the SAME ladder Plan My Day uses (2026-08-10),
    // so one tapped task behaves exactly like a planned pick: focus zones
    // first, then open time, routing around events and protected blocks,
    // inside the routine window. planStart already begins at "now" when the
    // selected day is today, so it never proposes the past.
    const split = splitProtectedRanges(blocked);
    const drop = planDay(
      [{ id, text: t.text, category: t.category ?? "", durationMin: 60 }],
      eventsForDate(allEvents, selected), planStart, planEnd, 10, split.hard, split.soft, split.focus,
    );
    const start = drop.blocks[0]?.start ?? nextFreeSlot(allEvents, selected, new Date());
    const end = addMinutes(start, 60);
    let evId: string | null = null;
    const ok = await attemptWrite(async () => {
      const r = await svc.commitPlan(selected, [{ taskId: id, text: t.text, category: t.category ?? "", start, end }]);
      evId = r.created[0] ?? null;
    });
    await reload();
    await reloadTasks();
    if (!ok) return;
    const guarded = evId ? await maybeAnchorGuard(selected, evId) : false;
    if (!guarded) showToast({
      message: `Scheduled ${fmtRange(start, end)}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(async () => { if (evId) await svc.deleteEvent(evId); }); await reload(); await reloadTasks(); },
    });
  };


  // PUT A TASK IN THIS BLOCK (2026-08-21). Blending only ever attached to real
  // calendar EVENTS, and a routine block is not an event, so the one block
  // built to receive tasks was the one block a task could not be dropped into.
  // This opens a picker of the day's unplaced tasks and lands the chosen one
  // in the block's first free stretch, through the same planner ladder
  // everything else uses.
  const [filling, setFilling] = useState<{ s: number; e: number } | null>(null);
  const onFillBlock = (s: number, e: number) => setFilling({ s, e });
  const fillWith = async (taskId: string) => {
    const win = filling;
    setFilling(null);
    if (!win) return;
    const t = await tasksSvc.task(taskId);
    if (!t) return;
    // Inside the block only, around anything already in it. planStart keeps
    // today's placements at or after now, so this never proposes the past.
    const from = Math.max(win.s, selected === todayISO() ? planStart : win.s);
    const drop = planDay(
      [{ id: taskId, text: t.text, category: t.category ?? "", durationMin: 45 }],
      eventsForDate(allEvents, selected), from, win.e, 10, [], [], [{ s: win.s, e: win.e }],
    );
    const block = drop.blocks[0];
    if (!block) { showToast({ message: "That block is full" }); return; }
    const ok = await attemptWrite(() => svc.commitPlan(selected, [{
      taskId, text: t.text, category: t.category ?? "", start: block.start, end: block.end,
    }]));
    await reload();
    await reloadTasks();
    if (ok) showToast({ message: `${t.text} at ${fmtRange(block.start, block.end)}` });
  };

  // --- Roadmap v2 schedule basics ---
  const nowHHMM = (() => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();

  // MOVING IS THE WHOLE FEATURE (Dave 2026-08-19: "the schedule is still way
  // too difficult to move things around. Locked in stuff should be moveable
  // with no issue").
  //
  // Every move goes through here, including repeating events. A repeating
  // event used to be excluded from every quick action outright, which is why
  // "locked in" things felt immovable: the only way to shift one was the full
  // editor. Blocking was never the right answer. Moving a SERIES from a swipe
  // is the footgun; moving ONE DAY of it is not, and the split-one-occurrence
  // path the editor already uses does exactly that. So:
  //   one-off   -> edit the times in place
  //   repeating -> exclude this date and drop a standalone copy at the new
  //                time, labelled "just today", with the series untouched
  // Both paths return a single Undo that restores the world exactly.
  //
  // 2026-08-28: the actual reads and writes for all five quick adjustments
  // (shift, retime, resize, skip-today, push-tomorrow) moved to
  // ./eventAdjust.ts so Today can offer the identical actions instead of a
  // second implementation of each. This function keeps the label wording and
  // the toast/undo wiring, which legitimately differ per surface.
  const moveEvent = async (id: string, toStart: string, label: string) => {
    let outcome: MoveOutcome | null = null;
    const ok = await attemptWrite(async () => { outcome = await moveEventAdjust(id, toStart, selected, svc); });
    await reload();
    const o = outcome as MoveOutcome | null;
    if (!ok || !o?.ok) return;
    showToast({
      message: o.repeating ? label + " · Just today" : label,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoMoveEventAdjust(id, selected, o, svc)); await reload(); },
    });
  };

  // Shift by a relative amount: the quick actions. Negative shifts exist
  // because until now nothing in the app could move an event EARLIER.
  const onShift = async (id: string, mins: number) => {
    const e = await svc.event(id);
    if (!e) return;
    // SCHED-F-18 (2026-09-05): refuse rather than clamp. addMinutes stops at
    // 23:59, so +1 hr on a 23:15-23:45 event used to leave 23:59-23:59, a
    // zero-length row. The event sheet already refuses this move; the swipe
    // now says the same thing out loud.
    if (!shiftFitsDay(e.start, e.end, mins)) { showToast({ message: "That would run past midnight" }); return; }
    const word = mins < 0
      ? `Back ${Math.abs(mins) === 60 ? "1 hr" : Math.abs(mins) + " min"}`
      : `Forward ${mins === 60 ? "1 hr" : mins + " min"}`;
    await moveEvent(id, addMinutes(e.start, mins), word);
  };

  // B3/B5 (2026-08-23): RESIZE, from the row. Until now the only way to change
  // how long something is was the full editor, on a row that already let you
  // change WHEN it is from two different controls. Same undo as every other
  // move, because a length change is as easy to fat-finger as a time change.
  //
  // A repeating event resizes for the whole series, which is correct and is
  // not the same footgun as MOVING one: the series keeps its slot, every
  // instance just gets longer or shorter. The toast says the new length so
  // there is no guessing what happened.
  const onSetEnd = async (id: string, end: string) => {
    let r: ResizeOutcome | null = null;
    const ok = await attemptWrite(async () => { r = await resizeEventAdjust(id, end, svc); });
    await reload();
    const res = r as ResizeOutcome | null;
    if (!ok || !res?.ok) return;
    const before = res.before;
    showToast({
      message: durLabel(res.minutes ?? 0),
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoResizeEventAdjust(id, before, svc)); await reload(); },
    });
  };

  // Move to an exact time (the time tap, and later the drag drop).
  const onMoveTo = async (id: string, start: string) => {
    const t = fmtTime(start);
    await moveEvent(id, start, `Moved to ${t.time} ${t.ap}`);
  };

  // SKIP JUST THIS ONE: a repeating thing you are not doing today should not
  // need deleting or an editor visit. The series never notices.
  const onSkipToday = async (id: string) => {
    const ok = await attemptWrite(() => skipEventTodayAdjust(id, selected, svc));
    await reload();
    if (!ok) return;
    showToast({
      message: "Skipped today",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoSkipEventTodayAdjust(id, selected, svc)); await reload(); },
    });
  };

  // Swipe: push one event to tomorrow, same time.
  //
  // SCHED-F-05 (2026-09-05): a repeating event pushes JUST THIS OCCURRENCE
  // (exdate here, standalone copy tomorrow), the same split every other quiet
  // move makes, and the toast says so. It used to move the series anchor, so
  // Tomorrow from the Overlaps sheet put every future Team sync on Wednesday.
  const onPushTomorrow = async (id: string) => {
    let outcome: PushOutcome | null = null;
    const ok = await attemptWrite(async () => { outcome = await pushEventTomorrowAdjust(id, selected, svc); });
    await reload();
    const o = outcome as PushOutcome | null;
    if (!ok || !o?.ok) return;
    showToast({
      message: o.repeating ? "Moved to tomorrow · Just today" : "Moved to tomorrow",
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => undoPushEventTomorrowAdjust(id, o, svc)); await reload(); },
    });
  };

  // THE SAME MOVES, FOR A PROTECTED BLOCK (2026-08-28, Dave: "It should
  // allow me to edit ALL schedule items THE FUCKING SAME"). Shift by the
  // swipe actions, retime from the time tap, resize from the "Until" tap -
  // all writing straight to the routine record instead of leaving this
  // screen for Your Routine. The whole routine is one record, so the write
  // is always "save the record back with this one block patched"; the undo
  // is always "save the record from before the patch."
  const onShiftBlock = async (id: string, mins: number) => {
    const before = routineData;
    // SCHED-F-18: the same refusal a late event gets, for a protected block.
    const cur = (before.protectedBlocks ?? []).find((b) => b.id === id);
    if (cur && !blockShiftFits(cur.startMin, cur.endMin, mins)) { showToast({ message: "That would run past midnight" }); return; }
    const after = shiftBlockAdjust(before, id, mins);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    const word = mins < 0
      ? `Back ${Math.abs(mins) === 60 ? "1 hr" : Math.abs(mins) + " min"}`
      : `Forward ${mins === 60 ? "1 hr" : mins + " min"}`;
    showToast({
      message: word,
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  const onRetimeBlock = async (id: string, startMin: number) => {
    const before = routineData;
    const after = retimeBlockAdjust(before, id, startMin);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    const t = fmtTime(minToHHMM(startMin));
    showToast({
      message: `Moved to ${t.time} ${t.ap}`,
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  const onResizeBlock = async (id: string, endMin: number) => {
    const before = routineData;
    const beforeBlock = (before.protectedBlocks ?? []).find((b) => b.id === id);
    const after = resizeBlockAdjust(before, id, endMin);
    if (!after || !beforeBlock) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    showToast({
      message: durLabel(endMin - beforeBlock.startMin),
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };

  // THE QUICK SHEET ITSELF (2026-08-28). Opens on a tap instead of leaving for
  // Your Routine; Save patches only name/time/days, same fields BlockSheet
  // exposes, and everything else on the block (kind, mode, Flexible,
  // location) rides along untouched.
  const onOpenBlock = (id: string) => {
    const b = (routineData.protectedBlocks ?? []).find((x) => x.id === id);
    if (!b) return;
    setBlockSheet({ id, initial: { label: b.label, startMin: b.startMin, endMin: b.endMin, days: [...b.days] } });
  };
  const onSaveBlock = async (draft: BlockDraft) => {
    if (!blockSheet) return;
    const before = routineData;
    const after = editBlockBasics(before, blockSheet.id, draft);
    setBlockSheet(null);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (ok) setRoutineData(after);
  };
  const onDeleteBlock = async () => {
    if (!blockSheet) return;
    const before = routineData;
    const removed = (before.protectedBlocks ?? []).find((b) => b.id === blockSheet.id);
    const after = removeBlockAdjust(before, blockSheet.id);
    setBlockSheet(null);
    if (!after) return;
    const ok = await attemptWrite(() => routine.save(after));
    if (!ok) return;
    setRoutineData(after);
    showToast({
      message: (removed?.label ?? "Block") + " deleted",
      actionLabel: "Undo",
      onAction: async () => { if (await attemptWrite(() => routine.save(before))) setRoutineData(before); },
    });
  };
  const onEditBlockFull = () => {
    if (!blockSheet) return;
    const id = blockSheet.id;
    setBlockSheet(null);
    onEditRoutine?.(id);
  };

  // Running Late: one tap shifts everything left in today as a unit. Recurring
  // events are skipped (shifting a series from one bad morning is wrong); the
  // toast says what moved and Undo restores every prior time.
  const onRunningLate = async (mins: number) => {
    let shift: ShiftResult | null = null;
    const ok = await attemptWrite(async () => { shift = await shiftFutureEvents(svc, dayEvents, nowHHMM, mins); });
    await reload();
    if (!ok || !shift) return;
    const { moved, skipped, crossed, prior } = shift;
    // SCHED-F-18: an event the shift would carry past midnight stayed where
    // it was, and the receipt says so rather than leaving a silent hole.
    if (moved === 0) { if (crossed) showToast({ message: "Nothing moved · The rest would run past midnight" }); return; }
    showToast({
      message: `${moved} ${moved === 1 ? "event" : "events"} +${mins === 60 ? "1 hr" : mins + " min"}${skipped ? ` · ${skipped} repeating stayed` : ""}${crossed ? ` · ${crossed} would pass midnight` : ""}`,
      actionLabel: "Undo",
      onAction: async () => { await attemptWrite(() => restoreShift(svc, prior)); await reload(); },
    });
  };

  // N5: the worst collision on the selected day. Worst, not first: if two
  // things clash by five minutes and two clash by an hour, the hour is the
  // one he actually needs told about. Reads the same acknowledged-filtered
  // list as the badges.
  const worstOverlap = [...dayOverlaps].sort((a, b) => b.byMin - a.byMin)[0] ?? null;

  // Badge tap (N5 completion): open the fix sheet on the pair this event is
  // part of. The later event of the pair is the one the sheet moves.
  const openOverlapFix = (eventId: string) => {
    const o = dayOverlaps.find((x) => x.a.id === eventId || x.b.id === eventId) ?? null;
    if (o) setFixing(o);
  };
  // The named landing slot for Move to Next Free: the first slot that clears
  // the collision, so the search starts where the earlier event ends (an
  // evening clash must not be offered a morning slot). Null when the day has
  // nothing honest to offer: nextFreeSlot's fallback re-proposes its own
  // start, so the result is re-checked against the day before the button is
  // allowed to promise it.
  const overlapNextFree = (o: Overlap): string | null => {
    const others = eventsForDate(allEvents, selected).filter((e) => e.id !== o.b.id);
    const dur = durationOf(o.b.data);
    const aEnd = toMin(o.a.data.start) + durationOf(o.a.data);
    const slot = nextFreeSlot(others, selected, new Date(), dur, minToHHMM(Math.min(aEnd, 24 * 60 - 1)));
    const s = toMin(slot);
    const honest = s + dur <= 24 * 60 && s >= aEnd
      && !others.some((e) => { const es = toMin(e.data.start), ee = e.data.end ? toMin(e.data.end) : es + 60; return s < ee && es < s + dur; });
    return honest ? slot : null;
  };
  const overlapMoveToFree = async (o: Overlap) => {
    const slot = overlapNextFree(o);
    if (!slot) return;
    const before = { start: o.b.data.start, end: o.b.data.end };
    const dur = durationOf(o.b.data);
    const ok = await attemptWrite(async () => {
      await svc.editTime(o.b.id, slot);
      if (before.end) await svc.editEnd(o.b.id, addMinutes(slot, dur));
    });
    await reload();
    if (ok) showToast({
      message: `${o.b.data.title} moved to ${fmtRange(slot, before.end ? addMinutes(slot, dur) : undefined)}`,
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => {
          await svc.editTime(o.b.id, before.start);
          if (before.end) await svc.editEnd(o.b.id, before.end);
        });
        await reload();
      },
    });
  };

  // N7: yesterday's one-offs, on today. Repeats are left alone: they already
  // appear here by themselves and copying one would double it.
  // E2: duplicate this event as a fresh one-off.
  const duplicateEvent = async (id: string) => {
    let made: string | undefined;
    const ok = await attemptWrite(async () => {
      made = (await duplicateEventMove(id, allEvents, selected, svc)).madeId;
    });
    setSheet(null);
    await reload();
    if (!ok || !made) return;
    const madeId = made;
    showToast({
      message: "Duplicated",
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(() => svc.deleteEvent(madeId));
        await reload();
      },
    });
  };

  const copyYesterday = async () => {
    const prev = addDays(selected, -1);
    const copies = copyDay(allEvents, prev, selected);
    if (copies.length === 0) { showToast({ message: "Nothing to copy from yesterday" }); return; }
    const made: string[] = [];
    const ok = await attemptWrite(async () => {
      for (const c of copies) {
        const id = await svc.createEvent(c.title, { date: c.date, start: c.start, end: c.end, category: c.category || undefined, location: c.location });
        if (id) made.push(id);
      }
    });
    await reload();
    if (ok) showToast({
      message: capAfterNumber(`${made.length} ${made.length === 1 ? "event" : "events"} copied`),
      actionLabel: "Undo",
      onAction: async () => {
        await attemptWrite(async () => { for (const id of made) await svc.deleteEvent(id); });
        await reload();
      },
    });
  };

  // D4-C: the gym is read lazily -- only when a door event is actually on
  // the calendar -- and re-read when the overlay closes (a finished session
  // may have stamped the block and moved history).
  const anyDoor = allEvents.some((e) => e.data.gym);
  useEffect(() => {
    if (!anyDoor || !gymSvc || gymDoorOpen) return;
    let on = true;
    void (async () => {
      const [programs, workouts] = await Promise.all([gymSvc.listPrograms(), gymSvc.listWorkouts()]);
      if (on) setGymData({ programs, workouts });
    })();
    return () => { on = false; };
  }, [anyDoor, gymSvc, gymDoorOpen]);

  const gymDoorFor = useCallback((e: EventItem) => {
    if (!e.data.gym || !gymSvc) return null;
    const trainedMin = e.data.trained?.[selected];
    if (trainedMin != null) return { trainedMin };
    const info = gymData ? doorInfoFor(gymData.programs, readActiveProgramId(), gymData.workouts, rackFrom(readGymSettings()), selected) : null;
    // Start only where starting is true: today's occurrence. A future date's
    // door still names its pinned lift; a past one stays quiet.
    const startable = selected === todayISO();
    const budgetMin = e.data.end ? Math.max(0, (Number(e.data.end.slice(0, 2)) * 60 + Number(e.data.end.slice(3))) - (Number(e.data.start.slice(0, 2)) * 60 + Number(e.data.start.slice(3)))) : 0;
    return {
      ...(info ? { dayName: info.day.name, meta: info.meta } : {}),
      ...(startable ? { onStart: () => setGymDoorOpen({ eventId: e.id, ...(budgetMin > 0 ? { budgetMin } : {}) }) } : {}),
    };
  }, [gymSvc, gymData, selected]);

  // Walking through the door mounts the gym whole, as an overlay -- same
  // pattern Brain uses. Coming back re-reads events so a fresh stamp shows.
  if (gymDoorOpen) {
    return <GymFlow door={gymDoorOpen} onBack={() => { setGymDoorOpen(null); void reload(); }} />;
  }

  return (
    <>
      <SchedulePage
        openSourceFor={openSourceFor}
        notedEvents={notedEvents}
        onNotes={onNavigate ? (e) => void openEventNote(e) : undefined}
        proposed={standingProposal}
        dayFooter={proposalFooter}
        year={view.y}
        month={view.m}
        selected={selected}
        todayDate={today}
        dots={dots}
        dayEvents={dayEvents}
        gymDoorFor={gymDoorFor}
        conflicts={conflicts}
        loading={loading}
        loadFailed={loadFailed}
        onRetryLoad={() => { setLoading(true); void reload(); }}
        mode={mode}
        onMode={setMode}
        repeats={repeatRows(allEvents)}
        overlap={worstOverlap ? { line: overlapLine(worstOverlap) } : null}
        onFixOverlap={worstOverlap ? () => openOverlapFix(worstOverlap.b.id) : undefined}
        clashCount={dayOverlaps.length}
        onOverlapBadge={openOverlapFix}
        onCopyDay={() => void copyYesterday()}
        weekCells={weekCells}
        weekRows={weekRows}
        onPrev={onPrev}
        onNext={onNext}
        onSelect={setSelected}
        onNew={() => setSheet({ mode: "new" })}
        onOpenEvent={openEdit}
        onPickSlot={onPickSlot}
        onPlanDay={() => setPlanOpen(true)}
        onUpload={ai.available ? () => setUploadOpen(true) : undefined}
        onDeleteMany={onDeleteManyEvents}
        locked={blocked}
        windowStartMin={planWindow.wakeMin}
        windowEndMin={planWindow.endMin}
        now={selected === today ? nowHHMM : null}
        onEditRoutine={onEditRoutine}
        onOpenBlock={onOpenBlock}
        onShift={onShift}
        onMoveTo={onMoveTo}
        onSetEnd={onSetEnd}
        onSkipToday={onSkipToday}
        onPushTomorrow={onPushTomorrow}
        onShiftBlock={onShiftBlock}
        onRetimeBlock={onRetimeBlock}
        onResizeBlock={onResizeBlock}
        onRunningLate={onRunningLate}
        onFillBlock={onFillBlock}
        anytimeItems={anytimeItems}
        parentOf={(t) => parentForTask(parentIdx, t)}
        onToggleTask={onToggleTask}
        onScheduleTask={onScheduleTask}
        attachMap={attachMap}
        firstMoveMap={firstMoveMap}
        blendMap={blendMap}
      />
      {fixing && (
        <OverlapSheet
          overlap={fixing}
          nextFree={overlapNextFree(fixing)}
          onNudge={(m) => { const o = fixing; setFixing(null); void onShift(o.b.id, m); }}
          onTomorrow={() => { const o = fixing; setFixing(null); void onPushTomorrow(o.b.id); }}
          onMoveToFree={() => { const o = fixing; setFixing(null); void overlapMoveToFree(o); }}
          onKeepBoth={() => { keepBoth(fixing, selected); setFixing(null); }}
          onClose={() => setFixing(null)}
        />
      )}
      {filling && (
        <div className="sheet-scrim" onClick={() => setFilling(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">Put a Task in This Block</div></div>
            <div className="pad-x sheet-form">
              {anytimeItems.length === 0 ? (
                <div className="empty-state"><div className="t-body">Nothing waiting to be scheduled</div></div>
              ) : (
                <div className="p3-list">
                  {anytimeItems.slice(0, 12).map((t) => (
                    <div className="p3-row" key={t.id} role="button" tabIndex={0} onClick={() => void fillWith(t.id)}>
                      <span className={"cat-dot cat-bg-" + catColor(t.data.category)} />
                      <div className="row-grow"><div className="p3-name truncate">{t.data.text}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-tertiary btn-block" onClick={() => setFilling(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {planOpen && (
        /* P7 wired here too (2026-08-24): making a task without leaving the
           planner is useful wherever the planner was opened from, and this
           entry point simply never passed it.

           `onTarget` and `sizing` stay absent, and that is NOT the same kind
           of gap. Today needs a today/tomorrow switch because it has no date
           picker; this tab IS a date picker. And the comment at the top of
           this file records mood sizing as a Today-surface behaviour on
           purpose. Two of the three "missing" props were correct all along. */
        <PlanDaySheet
          chosenCap={planCap}
          events={dayEvents}
          tasks={planCandidates}
          startMin={planStart}
          endMin={planEnd}
          date={selected}
          dayLabel={selected === todayISO() ? "Today" : new Date(selected + "T12:00:00").toLocaleDateString([], { weekday: "long" })}
          alreadyPlanned={dayEvents.filter((e) => !!e.data.sourceTaskId).map((e) => e.data.title)}
          // Plan My Day opens the standing draft for this date, not a
          // competing pick (merge phase 1).
          seed={seedFrom(readDraft(selected), planCandidates.map((c) => c.id))}
          routineConfigured={routineSet}
          blocked={blocked}
          onEditRoutine={onEditRoutine ? () => { setPlanOpen(false); onEditRoutine(); } : undefined}
          onAddTask={addPlanTask}
          onCommit={onPlanCommit}
          onAIPlan={onAIPlan}
          onClose={() => setPlanOpen(false)}
        />
      )}
      {uploadOpen && (
        <ScheduleUploadFlow
          ai={ai}
          svc={svc}
          categories={categories}
          existingEvents={allEvents}
          onDone={async ({ createdCount, updatedCount, undo }) => {
            setUploadOpen(false);
            await reload();
            const parts: string[] = [];
            if (createdCount) parts.push(`${createdCount} added`);
            if (updatedCount) parts.push(`${updatedCount} updated`);
            showToast({
              message: parts.join(", "),
              actionLabel: "Undo",
              onAction: async () => { await undo(); await reload(); },
            });
          }}
          onCancel={() => setUploadOpen(false)}
        />
      )}
      {sheet && (
        <EventSheet
          mode={sheet.mode}
          initial={sheet.mode === "edit" ? sheet.initial : { date: selected, start: newStart ?? nextFreeSlot(dayEvents, selected, new Date()) }}
          categories={categories}
          checkConflict={checkConflict}
          suggestSlot={suggestSlot}
          onSave={onSave}
          onDelete={sheet.mode === "edit" ? onDelete : undefined}
          onDuplicate={sheet.mode === "edit" ? () => void duplicateEvent(sheet.id) : undefined}
          onMoveToAnytime={sheet.mode === "edit" ? () => { const id = sheet.id; setSheet(null); onUnschedule(id); } : undefined}
          onCancel={() => { setSheet(null); setNewStart(null); }}
          suggestTitles={(typed) => suggestTitles(allEvents, typed)}
          suggestLocations={(t) => suggestLocations(allEvents, t)}
          attachTasks={attachableTasks}
          onToggleTask={onToggleAttached}
          onBlend={(kind, categoryId) => recordBlend(kind, categoryId)}
          source={sheet.mode === "edit" ? sheet.source : undefined}
          openSourceFor={openSourceFor}
          travelMemory={travelMemory}
        />
      )}
      {blockSheet && (
        <BlockSheet
          initial={blockSheet.initial}
          onSave={onSaveBlock}
          onDelete={onDeleteBlock}
          onEditFull={onEditRoutine ? onEditBlockFull : undefined}
          onCancel={() => setBlockSheet(null)}
        />
      )}
      {guard && (
        <div className="ag-scrim" onClick={() => setGuard(null)}>
          <div className="ag-card" onClick={(e) => e.stopPropagation()}>
            <div className="ag-title">That&rsquo;s four anchors</div>
            <div className="ag-body">A lighter day tends to stick. Want to keep this one in Anytime instead?</div>
            <div className="ag-acts">
              <button className="btn btn-primary btn-block" onClick={async () => { const g = guard; setGuard(null); if (g) await onUnschedule(g.id); }}>Keep in Anytime</button>
              <button className="btn btn-tertiary btn-block" onClick={() => setGuard(null)}>Leave it scheduled</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
