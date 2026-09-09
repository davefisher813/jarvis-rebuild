import { isIn } from "../tasks/categories";
import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useProjects, useGoals, useRoutine, usePeople, useProfile } from "../data/NotesProvider";
import { useOptionalGoogle } from "../connections/google/GoogleSession";
import type { Person } from "../people/types";
import { personInitials, avatarClass } from "../people/types";
import { upcomingBirthdays } from "../people/birthdays";
import { lastContactFor, agoLabel, isQuiet, checkinPrompt } from "../people/lastContact";
import { findWaiting, nudgePrompt, type WaitingRow } from "../messages/waiting";
import { useAI } from "../ai/useAI";
import { useOptionalAIContext } from "../ai/useAIContext";
import { voiceToText } from "../ai/context";
import { noDashes } from "../ai/suggestions";
import type { Category } from "../categories/types";
import type { NoteData, Recurrence } from "../notes/types";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { showToast } from "../shared/toast";
import type { TaskItem } from "../tasks/TasksService";
import { repetitionsLine } from "../tasks/automaticity";
import { effectiveKind } from "../categories/kinds";
import { weekReceipt, afterHoursLine, type WeekEvent } from "../categories/receipts";
import { categoryRecord, type RecordEntry } from "../categories/record";
import { DayDivide } from "../shared/anatomy";
import { eventLog } from "../events";
import { completionSamples } from "../events/completions";
import { todayISO } from "../tasks/grouping";
import { nextActionOf } from "../bigger/related";
import { dayPhrase } from "../money/bills";
import { fmtTime, addMinutes, addDays, eventsForDate } from "../schedule/calendar";
import { comingUpFor, gymDoorOn, type UpcomingRow } from "./comingUp";
import { FIFTEEN } from "../tasks/rightNow";
import { attemptWrite } from "../shared/guard";
import { buildParentIndex, parentForTask } from "../life/parent";
import { sheetEvents } from "../schedule/sheetEvents";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import ProjectSheet from "../projects/ProjectSheet";
import GoalSheet from "../life/GoalSheet";
import CategorySheet, { type CategoryDraft } from "../categories/screens/CategorySheet";
import EventSheet from "../schedule/screens/EventSheet";
import GymFlow from "../gym/GymFlow";
import { useGym, useMetrics, useHealth } from "../data/NotesProvider";
// S5-Q29 (2026-09-04): the four highest-value loggers grafted from the
// dormant Health module. See HealthBody.tsx's HealthLoggerKey doc comment
// for why these four and not the fifth (Ate Before).
import LightsOutScreen from "../health/screens/LightsOutScreen";
import TookItScreen from "../health/screens/TookItScreen";
import CallItScreen from "../health/screens/CallItScreen";
import PointAtItScreen from "../health/screens/PointAtItScreen";
import type { LightsOutEntry, TookItEntry, CallItEntry, PointAtItEntry } from "../health/types";
import { tookItTimeline, stillThere, stillThereSummary, stillThereMessage } from "../health/timelines";
import { healthComebackMessage } from "../health/healthComeback";
// HMN-F-06 (2026-09-05), fork option A: the other fourteen screens of the
// health module, mounted behind the More row on this page. See the
// HEALTH_MORE list below for the three that stay dormant and why.
import HealthFlow, { type ScreenKey as HealthScreenKey } from "../health/HealthFlow";
import type { SportSession } from "../health/loadCandidates";
import type { FixedCommitment } from "../health/nightBefore";
import type { DayBlock } from "../health/eatingWindows";
import type { SessionStartCandidate } from "../health/medWindow";
import type { EventItem } from "../schedule/types";
import type { TemplateKey } from "../categories/defaults";
import { localDayParts } from "../events/serverSink";
import type { HealthLoggerKey, HealthLoggerRow } from "./HealthBody";
import type { Program } from "../gym/types";
import { capAfterNumber } from "../shared/casing";
import { ProjectPie } from "../shared/glyphs";
import GoalRowRuled from "../bigger/GoalRowRuled";
import { TaskRow } from "../tasks/screens/TasksPage";
import { trainingSummary, agoPhrase } from "../gym/summary";
import type { Workout } from "../gym/types";
import { buildGoalIndex, liveGoals, reachOf, reachLine } from "../bigger/reach";
import { measureState, healthOf, HEALTH_LABEL, type MeasureContext } from "../bigger/measure";
import { goalTone } from "../shared/categories";
import HealthBody, { type HealthGoalRow } from "./HealthBody";
import { openWorkOf } from "../today/goalPulse";
import { MetricLogSheet, AddMetricSheet } from "../gym/MetricsCard";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { newMetricDefData, activeMetrics, pulsePlan } from "../gym/metrics";
import { chartableExercises, liftSessions } from "../gym/chartData";
import { correlate, plateauFlag, hardSetRows, muscleMapFromProgram, backOffSignal, shouldOfferLighterWeek } from "../gym/insights";
import { MUSCLE_LABEL } from "../gym/muscles";
import { pressable } from "../shared/pressable";
import { madeBy, type Source } from "../shared/provenance";
import { OFFER_RECEIPT, type HealthOffer } from "../health/offers";

// UP-ATH-10 (2026-09-06): the three small facts applyHealthOffer needs.
// pbId mints a protected-block id the same way the routine editor does
// (routine/RoutineFlow.tsx); WIND_DOWN_MIN is how long the block runs, which
// is the catalog's own wind-down buffer rather than a number invented here;
// healthSource stamps what made the row so the card can say so.
function pbId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return "pb_" + crypto.randomUUID();
  return "pb_" + Math.random().toString(36).slice(2);
}
const WIND_DOWN_MIN = 30;
/** A local calendar day from an instant. Never toISOString: that reads UTC
 *  and lands on the wrong day for anyone west of Greenwich. */
function localDayOf(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function healthSource(): Source {
  return madeBy("health");
}

const CHEV = (
  <div className="chev" />
);
const UP_NEXT_CAP = 6;

// V2 anatomy: one day label per group, not one per row.
function groupByDay(recent: RecordEntry[]): { day: string; rows: RecordEntry[] }[] {
  const out: { day: string; rows: RecordEntry[] }[] = [];
  for (const r of recent) {
    const last = out[out.length - 1];
    if (last && last.day === r.when) last.rows.push(r);
    else out.push({ day: r.when, rows: [r] });
  }
  return out;
}
const NOTES_CAP = 4;

type SheetState = { kind: "closed" } | { kind: "task" } | { kind: "project" } | { kind: "goal" } | { kind: "event" } | { kind: "edit" };


// The category page (2026-08-03), replacing the read-only archive. Pages are
// RECEIPTS for behavior happening elsewhere: the Record is derived from real
// completions and events, Up Next is the real open tasks, adds are born
// tagged. The org kind adds Projects (6.6 machinery scoped here) and the
// Season / Work hours settings via the editor.
export default function CategoryDetail({
  categoryId,
  onBack,
  onOpenNote,
  onOpenProject,
  onOpenPerson,
  onOpenContacts,
  onOpenTask,
  onOpenGoal,
  onChanged,
  autoOpenGym,
  gymNonce,
  onGymConsumed,
}: {
  categoryId: string;
  onBack: () => void;
  onOpenNote?: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  onOpenContacts?: () => void;
  onOpenTask?: (id: string) => void;
  onOpenGoal?: (id: string) => void;
  onChanged?: () => void;
  // S5-Q31: "Back to <day>" on Today lands here already knowing a live
  // session is waiting.
  autoOpenGym?: boolean;
  // BRAIN-F-04 (2026-09-05): seeding gymOpen at mount was not enough. The
  // shell kept the flag until a bottom-tab tap, so every later open of the
  // Health area walked straight back into the live session, and a SECOND
  // "Back to <day>" while this page was already open did nothing. The effect
  // below opens on the flag (nonce included, so a repeat still counts) and
  // consumes it.
  gymNonce?: number;
  onGymConsumed?: () => void;
}) {
  const tasksSvc = useTasks();
  const schedule = useSchedule();
  const notesSvc = useNotes();
  const catsSvc = useCategories();
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const routine = useRoutine();
  const peopleSvc = usePeople();
  const google = useOptionalGoogle();

  const [cat, setCat] = useState<Category | null>(null);
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [open, setOpen] = useState<TaskItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  // The Notes section shows at most NOTES_CAP; the delete cost counts them all.
  const [noteCount, setNoteCount] = useState(0);
  const [events, setEvents] = useState<WeekEvent[]>([]);
  // Full event rows for the Coming Up section (WeekEvent above is the thin
  // shape the receipt needs; this keeps titles and times).
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  // BRAIN-F-07 (2026-09-05): today's gym block, read from the `gym` flag
  // across every category rather than picked out of this page's own upcoming
  // list. The old lookup took the first Health-tagged event of the day, so a
  // dentist appointment became "the gym block", and the daily recurring block
  // Dave actually has (anchored weeks ago) was never in that list at all.
  const [gymDoor, setGymDoor] = useState<{ id: string; start: string } | null>(null);
  // The people in this category (person.categoryIds, set from the person's
  // own card). Written since the person-pass; READ for the first time here.
  const [catPeople, setCatPeople] = useState<Person[]>([]);
  // UP-ATH-07 (2026-09-06): every person, not only this area's, because the
  // adult you would call in a crisis is not necessarily filed under Health.
  const [allPeople, setAllPeople] = useState<Person[]>([]);
  // Last mail contact per person id, derived from Gmail when connected.
  const [contact, setContact] = useState<Record<string, number | null>>({});
  // Sent-and-unanswered threads keyed by person id (waiting.ts derivation).
  const [waitingBy, setWaitingBy] = useState<Record<string, WaitingRow>>({});
  // Person id currently having a nudge drafted (disables the button).
  const [nudging, setNudging] = useState<string | null>(null);
  const [work, setWork] = useState<{ startMin: number; endMin: number } | null>(null);
  const [pushedWeek, setPushedWeek] = useState(0);
  const [sheet, setSheet] = useState<SheetState>({ kind: "closed" });
  const gymSvc = useGym();
  const metricsSvc = useMetrics();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [gymOpen, setGymOpen] = useState(!!autoOpenGym);
  useEffect(() => {
    if (!autoOpenGym) return;
    setGymOpen(true);
    onGymConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenGym, gymNonce]);
  // The Health hero's Start names the day; the gym walks into it (2026-09-02).
  const [gymStartDay, setGymStartDay] = useState<string | null>(null);
  // D10-B/D11-C/D13-C: the metric strip and the insight cards, health-kind
  // pages only. Reloaded alongside the gym read (gymOpen dep) so a metric
  // logged from the strip and a set logged in the gym both show up fresh.
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const [metricLogs, setMetricLogs] = useState<MetricLog[]>([]);
  const [metricSheet, setMetricSheet] = useState<{ kind: "log"; def: MetricDef } | { kind: "add" } | null>(null);
  // S5-Q29 (2026-09-04): the four grafted Health loggers, health-kind pages
  // only, same read/reload shape as the metric strip just above.
  const healthSvc = useHealth();
  const profileSvc = useProfile();
  const [healthScreen, setHealthScreen] = useState<HealthLoggerKey | null>(null);
  // HMN-F-06 (2026-09-05), option A: the rest of the health module, behind
  // the More row. `healthMore` is the menu, `healthDeep` is the screen it
  // opened. Student only: this is the student-athlete track, and a Personal
  // or Business page has no use for The Third Practice or The Bag.
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  const [healthMore, setHealthMore] = useState(false);
  const [healthDeep, setHealthDeep] = useState<HealthScreenKey | null>(null);
  // Full event rows (the `events` state above is the thin shape the week
  // receipt needs); the health candidates below are built from these.
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [lightsOut, setLightsOut] = useState<LightsOutEntry[]>([]);
  const [tookIt, setTookIt] = useState<TookItEntry[]>([]);
  const [callIt, setCallIt] = useState<CallItEntry[]>([]);
  const [pointAtIt, setPointAtIt] = useState<PointAtItEntry[]>([]);
  // UP-ATH-05 (2026-09-06): the dated Still There? summary, in flight from
  // Point at It to Say It to Someone. BRAIN-F-26's question (who does this
  // button actually reach) moved with it: the destination is a screen that
  // holds the athlete's own person, the share sheet, and the line for their
  // region, and hides the last of those when there is none to state, rather
  // than this page dialling a bare number from anywhere on earth.
  const [handOff, setHandOff] = useState<string | null>(null);
  // Full project list, unfiltered: goal reach is computed across ALL
  // projects (a goal tagged here can be filed anywhere).
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  // This Week's day groups start capped; See All opens the rest.
  const [weekOpen, setWeekOpen] = useState(false);
  const today = todayISO();

  const reload = useCallback(async () => {
    const [c, cs, tk, pj, gl, nt, ev, rt, ppl, prof] = await Promise.all([
      catsSvc.get(categoryId),
      catsSvc.list(),
      tasksSvc.listTasks(),
      projectsSvc.list(),
      goalsSvc.list(),
      notesSvc.listNotes(),
      schedule.listEvents(),
      routine.get(),
      peopleSvc.list(),
      profileSvc.get(),
    ]);
    // HMN-F-06: which template this account is on, for the More row's gate.
    setTemplate(prof?.template ?? "personal");
    setAllEvents(ev);
    setCat(c);
    setAllCats(cs);
    setAllTasks(tk);
    setOpen(
      // A tagged task belongs on this page too (2026-08-21): membership is
      // "carries this category in any position", not "has it as primary".
      tk.filter((t) => isIn(t.data, categoryId) && !t.data.done)
        .sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"))
        .slice(0, UP_NEXT_CAP),
    );
    setProjects(pj.filter((p) => p.data.category === categoryId && p.data.status !== "done"));
    setAllProjects(pj);
    setGoals(gl);
    const mineNotes = tk && nt ? nt.filter((n) => (n.data as unknown as NoteData).category === categoryId) : [];
    setNoteCount(mineNotes.length);
    setNotes(mineNotes.slice(0, NOTES_CAP).map((n) => ({ id: n.id, title: ((n.data as unknown as NoteData).title || "Untitled") })));
    setEvents(ev.map((e) => ({ date: e.data.date, start: e.data.start, category: e.data.category })));
    const nowIso = todayISO();
    // Coming Up walks the next days through occursOn (brain/comingUp.ts), so
    // a weekly practice or a standing meeting shows its NEXT date instead of
    // being dropped for having an anchor date in the past.
    setUpcoming(comingUpFor(ev, categoryId, nowIso));
    const door = gymDoorOn(ev, nowIso);
    setGymDoor(door ? { id: door.id, start: door.data.start } : null);
    setCatPeople(ppl.filter((p) => (p.data.categoryIds ?? []).includes(categoryId)));
    setAllPeople(ppl);
    // Pushed-forward count for the week (2026-08-10): the receipt told half
    // the story (what got done); this is the honest other half, read from the
    // same local event log the pushes already write to.
    const weekAgo = Date.now() - 7 * 86400000;
    setPushedWeek(eventLog.all().filter((e) => e.type === "task.pushed" && e.ts >= weekAgo && e.props?.category === categoryId).length);
    setWork(rt ? { startMin: rt.workStartMin, endMin: rt.workEndMin } : null);
  }, [catsSvc, tasksSvc, projectsSvc, goalsSvc, notesSvc, schedule, routine, peopleSvc, profileSvc, categoryId]);

  useEffect(() => { void reload(); }, [reload]);

  // Training lives behind the health kind (gym track, 2026-08-04).
  useEffect(() => {
    let on = true;
    gymSvc.listPrograms().then((p) => { if (on) setPrograms(p); }).catch(() => {});
    // The page reads the gym, it does not open it: last session, the week's
    // dots, a fresh PR and a climber all come from the workout list.
    gymSvc.listWorkouts().then((w) => { if (on) setWorkouts(w); }).catch(() => {});
    return () => { on = false; };
  }, [gymSvc, gymOpen]);

  // D10-B: the metric strip's own read, alongside the gym read (same
  // gymOpen dep) so a set logged in the gym and a metric logged from the
  // strip both show up fresh without a second trigger to track.
  useEffect(() => {
    let on = true;
    metricsSvc.listDefs().then((d) => { if (on) setMetricDefs(d); }).catch(() => {});
    metricsSvc.listLogs().then((l) => { if (on) setMetricLogs(l); }).catch(() => {});
    return () => { on = false; };
  }, [metricsSvc, gymOpen]);

  // S5-Q29: reloaded on the same healthScreen-closes dep gymOpen's read uses,
  // so a tap logged from any of the four screens shows up fresh the moment
  // its screen closes, with no separate trigger to track.
  useEffect(() => {
    let on = true;
    healthSvc.listLightsOut().then((l) => { if (on) setLightsOut(l); }).catch(() => {});
    healthSvc.listTookIt().then((l) => { if (on) setTookIt(l); }).catch(() => {});
    healthSvc.listCallIt().then((l) => { if (on) setCallIt(l); }).catch(() => {});
    healthSvc.listPointAtIt().then((l) => { if (on) setPointAtIt(l); }).catch(() => {});
    return () => { on = false; };
  }, [healthSvc, healthScreen]);

  // A WRITE THAT FAILS SAYS SO (Dave 2026-09-02, "the metrics page literally
  // doesn't work"). For weeks every switch on Add a Metric threw at the
  // database (the entity types were never registered, migration 0029) and
  // the sheet swallowed it, so a dead button was all he could see. Same
  // rule the Routine save learned on 2026-07-30: try, catch, toast.
  const metricWrite = async (write: () => Promise<unknown>, then?: () => void) => {
    try {
      await write();
      then?.();
      await reloadMetrics();
    } catch (e) {
      showToast({ message: "Couldn't save that metric. " + (e instanceof Error && e.message ? e.message : "Check your connection and try again.") });
    }
  };
  const reloadMetrics = async () => {
    const [d, l] = await Promise.all([metricsSvc.listDefs(), metricsSvc.listLogs()]);
    setMetricDefs(d);
    setMetricLogs(l);
  };

  // Last contact (2026-08-10): one cached Gmail lookup per person with an
  // email. Silent degrade: no Google session or no email means the subline
  // simply is not there, never an error and never a spinner.
  useEffect(() => {
    const api = google?.api();
    if (!api || catPeople.length === 0) return;
    let on = true;
    (async () => {
      const now = Date.now();
      for (const p of catPeople.slice(0, 15)) {
        const email = p.data.email;
        if (!email) continue;
        const ms = await lastContactFor(api, email, now);
        if (!on) return;
        setContact((prev) => ({ ...prev, [p.id]: ms }));
      }
      // Waiting On, scoped to these people: emails the user sent them that
      // never got a reply. One derivation call, matched by address.
      try {
        const rows = await findWaiting(api, now, 15);
        if (!on) return;
        const byId: Record<string, WaitingRow> = {};
        for (const p of catPeople) {
          const e = p.data.email?.trim().toLowerCase();
          if (!e) continue;
          const row = rows.find((r) => r.toEmail.toLowerCase() === e);
          if (row) byId[p.id] = row;
        }
        setWaitingBy(byId);
      } catch { /* silent: the section just shows less */ }
    })();
    return () => { on = false; };
  }, [google, catPeople]);

  // One-tap nudge (2026-08-10): drafts a short message in the user's voice
  // (follow-up when they owe a reply, check-in when things just went quiet)
  // and opens the mail app with it, via mailto. Nothing sends without the
  // user hitting send in their own mail app. AI unavailable = a blank
  // compose, still useful, never an error.
  const ai = useAI();
  const gatherCtx = useOptionalAIContext();
  const nudge = async (p: Person) => {
    const email = p.data.email;
    if (!email || nudging) return;
    setNudging(p.id);
    try {
      const wrow = waitingBy[p.id];
      let body = "";
      if (ai.available) {
        const voice = await gatherCtx().then((c) => (c ? voiceToText(c) : "")).catch(() => "");
        const prompt = wrow
          ? nudgePrompt(wrow, voice)
          : checkinPrompt(p.data.name, contact[p.id] != null ? agoLabel(contact[p.id]!, Date.now()) : "a while ago", voice);
        body = noDashes((await ai.complete([{ role: "user", content: prompt.user }], prompt.system, { tier: "write" })).trim());
      }
      const subject = wrow ? "Re: " + wrow.subject : "";
      const q = [
        subject ? "subject=" + encodeURIComponent(subject) : "",
        body ? "body=" + encodeURIComponent(body) : "",
      ].filter(Boolean).join("&");
      window.location.href = "mailto:" + email + (q ? "?" + q : "");
    } catch {
      window.location.href = "mailto:" + email;
    } finally {
      setNudging(null);
    }
  };

  if (!cat) return <div className="screen" />;
  // reload() on the way back out, not just gymOpen's own workouts/programs
  // effect: a lift/training goal set from inside the gym (D12-A/C) writes
  // straight to GoalService, bypassing this page's own goals state, so
  // without this the new goal is invisible under Goals Here until some
  // OTHER trigger happens to reload the page.
  // B5 (2026-09-04): a session started from here never carried the calendar
  // gym block's event id, so finishing it had nothing to stamp -- the block
  // sat offering Start on a session already logged, open to a double entry.
  // BRAIN-F-07 (2026-09-05): the door is gymDoor, the block marked `gym`,
  // not "whatever this page had first on today's list".
  if (gymOpen) return <GymFlow areaId={categoryId} startDayId={gymStartDay ?? undefined} startDoorEventId={gymDoor?.id} onBack={() => { setGymOpen(false); setGymStartDay(null); void reload(); }} />;
  // S5-Q29: the four grafted Health screens, unmodified from the dormant
  // module -- they were always presentational (props in, callbacks out),
  // never wired to a store of their own. onBack just closes the screen;
  // the effect above already refetches everything on that same dep.
  // UP-ATH-22 (2026-09-06): BACK ON TRACK reaches the grafted loggers too.
  // healthComebackMessage has existed and been tested since the module
  // shipped, and only HealthFlow's own copies of these screens called it, so
  // the four loggers actually reachable from this page said nothing when
  // somebody came back after a fortnight away. Read BEFORE the tap lands, the
  // same ordering TodayFlow.onToggleTask uses for tasks, so the gap being
  // judged is the real one rather than one this tap has already closed. The
  // helper itself refuses to say anything about what was skipped: it names
  // the run that came before, never the days that were not logged.
  const celebrateHealthLog = (marksBefore: { at: number }[]) => {
    const msg = healthComebackMessage(marksBefore, today);
    if (msg) showToast({ message: msg });
  };
  if (healthScreen === "lightsOut") {
    return (
      <LightsOutScreen
        last={lightsOut[lightsOut.length - 1] ?? null}
        onLog={() => { celebrateHealthLog(lightsOut.map((e) => ({ at: e.data.at }))); healthSvc.logLightsOut(); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "tookIt") {
    return (
      <TookItScreen
        timeline={tookItTimeline(tookIt)}
        onLog={() => { celebrateHealthLog(tookIt.map((e) => ({ at: e.data.at }))); healthSvc.logTookIt(); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "callIt") {
    return (
      <CallItScreen
        history={callIt.map((e) => ({ at: e.data.at, rpe: e.data.rpe, durationMin: e.data.durationMin }))}
        onLog={(rpe) => { celebrateHealthLog(callIt.map((e) => ({ at: e.data.at }))); healthSvc.logCallIt({ rpe }); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "pointAtIt") {
    const patterns = stillThere(pointAtIt);
    const summaries = patterns.map((p) => stillThereSummary(pointAtIt, p));
    return (
      <PointAtItScreen
        patterns={patterns}
        // UP-ATH-05 (2026-09-06): this page showed the pattern's count and
        // withheld the dates behind it, then handed the button a bare tel:
        // link, so the one action on the screen placed a call with no summary
        // in it. The dates are on the screen, and they travel with the tap.
        summaries={summaries}
        onLog={(x, y, side) => { healthSvc.logPointAtIt({ x, y, side }); }}
        onHandToSomeone={() => {
          setHandOff(stillThereMessage(patterns, summaries));
          setHealthScreen(null);
          setHealthDeep("sayItToSomeone");
        }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  const kind = effectiveKind(cat.data);
  const isOrg = kind === "org";
  const paused = isOrg && cat.data.season === "paused";

  // HMN-F-06 (2026-09-05), fork option A. The health module shipped 21
  // screens. S5-Q29 grafted four loggers onto this page; the other seventeen
  // were written, tested, and had no path into the app at all. Fourteen open
  // from here now, behind one More row, on the Student template only: this
  // is the student-athlete track, and a Personal or Business page has no use
  // for The Third Practice or The Bag.
  //
  // Every candidate below is real calendar data, never a stand-in. Three
  // screens stay dormant for reasons this page cannot argue away:
  //   Ate Before   asks about "today's practice or game", and nothing marks
  //                an event as either. That question IS the whole screen.
  //   The Age Rule states facts about an athlete's hours for their age, and
  //                nothing stores an age or a season length. Its defaults
  //                (15 years, 9 months) would be invented facts about a person.
  //   Season Feed  commits a whole season off an extraction, and its receipt
  //                announces the events before anything writes them
  //                (HMN-F-22). It waits for that.
  // Only the health page asks any of this, and this component renders on
  // every area, so the calendar walk below is gated rather than run and
  // thrown away.
  const healthOn = kind === "health";
  const DEFAULT_EVENT_MIN = 60; // ScheduleFlow's own length when it makes one
  const endOf = (e: EventItem) => e.data.end ?? addMinutes(e.data.start, DEFAULT_EVENT_MIN);
  const msOf = (date: string, hhmm: string) => new Date(date + "T" + hhmm + ":00").getTime();
  // An ORG area IS a team or a program: that is what the kind means, so the
  // org is that area's name. Read from the kind, never from what it is called.
  const orgName = new Map(allCats.filter((c) => effectiveKind(c.data) === "org").map((c) => [c.id, c.data.name] as const));
  // Through eventsForDate, so a weekly practice anchored months ago counts on
  // the day it actually happens rather than only on its anchor date.
  const dayEvents = (date: string) => eventsForDate(allEvents, date);
  const healthWeek = healthOn ? Array.from({ length: 7 }, (_, i) => addDays(today, i)) : [];
  const sportSessions: SportSession[] = healthWeek.flatMap((date) =>
    dayEvents(date)
      .filter((e) => orgName.has(e.data.category))
      .map((e) => ({
        date,
        org: orgName.get(e.data.category)!,
        title: e.data.title,
        durationMin: Math.max(0, Math.round((msOf(date, endOf(e)) - msOf(date, e.data.start)) / 60000)),
      })),
  );
  const tomorrow = addDays(today, 1);
  const tomorrowEvents = healthOn ? dayEvents(tomorrow) : [];
  const nightBeforeCommitments: FixedCommitment[] = tomorrowEvents
    .map((e) => ({ title: e.data.title, at: msOf(tomorrow, e.data.start) }));
  const eatingWindowBlocks: DayBlock[] = tomorrowEvents
    .map((e) => ({ title: e.data.title, start: msOf(tomorrow, e.data.start), end: msOf(tomorrow, endOf(e)) }));
  const sessionStarts: SessionStartCandidate[] = (healthOn ? dayEvents(today) : [])
    .filter((e) => orgName.has(e.data.category))
    .map((e) => ({ date: today, at: msOf(today, e.data.start), title: e.data.title }));
  // The Bag binds a checklist to ONE event: the next session on the calendar.
  // No session, no row, because a checklist bound to nothing packs nothing.
  const bagSource = healthWeek
    .flatMap((d) => dayEvents(d).filter((e) => orgName.has(e.data.category)).map((e) => ({ e, date: d })))[0];
  const bagEvent = bagSource ? { eventId: bagSource.e.id, eventTitle: bagSource.e.data.title, date: bagSource.date } : undefined;
  // An offer taken on a health screen lands where everything else this page
  // makes lands: a task on this area's list. The answer travels back so the
  // screen's receipt waits for the write instead of announcing on the tap.
  const landHealthTask = async (line: string): Promise<boolean> => {
    const ok = await attemptWrite(() => tasksSvc.createTask(line, { category: categoryId, source: healthSource() }));
    if (ok) await reload();
    return ok;
  };
  // UP-ATH-10 (2026-09-06): the offers make the thing they name. Every health
  // screen ends in an offer (rail 6) and HMN-F-06 made all five of them land
  // as the same untimed task, so "Add Wind Down" produced a row on a list
  // instead of an hour the planner will not fill, and "Place a Rest Block"
  // produced one instead of a day on the calendar. Each kind writes through
  // the primitive that already exists for it, carries provenance so the row
  // can say where it came from, and offers an Undo through the same delete
  // path the rest of the app uses. The receipt still waits for the write:
  // attemptWrite answers, and HealthFlow's `take` only toasts on true.
  const applyHealthOffer = async (offer: HealthOffer): Promise<false | { undo: () => void }> => {
    if (offer.kind === "task") {
      let id: string | null = null;
      const ok = await attemptWrite(async () => { id = await tasksSvc.createTask(offer.line, { category: categoryId, source: healthSource() }); });
      if (!ok) return false;
      await reload();
      return { undo: () => void (async () => { if (id) await attemptWrite(() => tasksSvc.deleteTask(id!)); await reload(); })() };
    }

    if (offer.kind === "reminder") {
      const at = new Date(offer.at);
      const time = String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0");
      let id: string | null = null;
      const ok = await attemptWrite(async () => {
        id = await tasksSvc.createTask(offer.line, {
          category: categoryId,
          due: localDayOf(at),
          reminder: { time, days: [at.getDay()] },
          source: healthSource(),
        });
      });
      if (!ok) return false;
      await reload();
      return { undo: () => void (async () => { if (id) await attemptWrite(() => tasksSvc.deleteTask(id!)); await reload(); })() };
    }

    if (offer.kind === "windDown") {
      // A protected block, on the one weekday this wind-down is for. The
      // routine is a weekly shape, so a block lands on the day the offer is
      // about and no others: turning one night's offer into every night's
      // rule would be the app deciding how somebody lives.
      const at = new Date(offer.at);
      const startMin = at.getHours() * 60 + at.getMinutes();
      const rt = await routine.get();
      const before = rt.protectedBlocks ?? [];
      const block = {
        id: pbId(),
        label: "Wind Down",
        startMin,
        endMin: Math.min(24 * 60 - 1, startMin + WIND_DOWN_MIN),
        days: [at.getDay()],
        kind: "other" as const,
        mode: "protects" as const,
      };
      const ok = await attemptWrite(() => routine.save({ protectedBlocks: [...before, block] }));
      if (!ok) return false;
      await reload();
      return { undo: () => void (async () => { await attemptWrite(() => routine.save({ protectedBlocks: before })); await reload(); })() };
    }

    // The two calendar kinds. A rest day anchors at the athlete's own wake
    // time rather than a number this page made up; a protected gap sits in
    // the real hole between the day's own commitments, and there is nothing
    // honest to place when the day has no hole, so that falls back to a task.
    const rt = await routine.get();
    const wake = rt.wakeMin;
    let start = String(Math.floor(wake / 60)).padStart(2, "0") + ":" + String(wake % 60).padStart(2, "0");
    let end: string | undefined;
    let title = offer.line;
    if (offer.kind === "protectGap") {
      const onDay = dayEvents(offer.date)
        .map((e) => ({ s: e.data.start, e: endOf(e) }))
        .sort((a, b) => a.s.localeCompare(b.s));
      const hole = onDay.slice(0, -1).map((x, i) => ({ from: x.e, to: onDay[i + 1]!.s })).find((g) => g.to > g.from);
      if (!hole) return applyHealthOffer({ kind: "task", line: offer.line });
      start = hole.from;
      end = hole.to;
      title = "Protected Gap";
    }
    let id: string | null = null;
    const ok = await attemptWrite(async () => {
      id = await schedule.createEvent(title, {
        date: offer.date,
        start,
        ...(end ? { end } : {}),
        category: categoryId,
        source: healthSource(),
      });
    });
    if (!ok) return false;
    await reload();
    return { undo: () => void (async () => { if (id) await attemptWrite(() => schedule.deleteEvent(id!)); await reload(); })() };
  };
  // UP-ATH-01 (2026-09-06): `everyone` marks the rows that are about a person
  // and their own medication, which is not a student-athlete question: an
  // adult on a monthly script has exactly the same use for a dose runway, a
  // med window and a dated log to hand a prescriber. HMN-F-06 gated the whole
  // menu on the Student template, which meant a Personal account (the default,
  // and the one this app is used on today) could not open a single one of the
  // fourteen screens. The rest stay Student: The Share Line and What They See
  // are about what crosses to a parent, The Bag and The Third Practice are
  // about a season, and neither question exists on a Personal page.
  type HealthMoreRow = { group: string; key: HealthScreenKey; label: string; sub: string; everyone?: boolean };
  const healthMoreRows: HealthMoreRow[] = ([
    { group: "Sharing", key: "share", label: "The Share Line", sub: "What crosses to a parent, one switch at a time" },
    { group: "Sharing", key: "whatTheySee", label: "What They See", sub: "The same list, from their side" },
    { group: "Sharing", key: "sayItToSomeone", label: "Say It to Someone", sub: "The adult Point at It hands to", everyone: true },
    { group: "Medication", key: "refillRunway", label: "Refill Runway", sub: "Doses left in this fill", everyone: true },
    { group: "Medication", key: "medWindow", label: "The Med Window", sub: "Dose, food, session start, lights out, by day", everyone: true },
    { group: "Medication", key: "doctorReport", label: "Take This to the Doctor", sub: "The last few weeks on one page", everyone: true },
    { group: "Tomorrow", key: "nightBefore", label: "The Night Before", sub: "A wind-down before tomorrow's first fixed thing" },
    { group: "Tomorrow", key: "eatingWindows", label: "Eating Windows", sub: "Where tomorrow leaves no room" },
    ...(bagEvent ? [{ group: "Tomorrow", key: "theBag" as HealthScreenKey, label: "The Bag", sub: bagEvent.eventTitle }] : []),
    { group: "The Week", key: "thirdPractice", label: "The Third Practice", sub: "Days that carry two teams" },
    { group: "The Week", key: "weekShape", label: "Week Shape", sub: "Sessions and hours, day by day" },
    { group: "The Week", key: "twoDaysOff", label: "Two Days Off", sub: "Where a rest day fits" },
    { group: "Keeping", key: "locker", label: "The Locker", sub: "Forms and the dates they run out" },
    { group: "Keeping", key: "handoff", label: "The Handoff", sub: "What the next adult needs to know" },
  ] as HealthMoreRow[]).filter((r) => template === "student" || r.everyone === true);

  if (healthDeep) {
    return (
      <HealthFlow
        service={healthSvc}
        initialScreen={healthDeep}
        initialHandOff={handOff ?? undefined}
        onExit={() => { setHealthDeep(null); setHandOff(null); void reload(); }}
        sportSessions={sportSessions}
        weekDates={healthWeek}
        nightBeforeCommitments={nightBeforeCommitments}
        eatingWindowBlocks={eatingWindowBlocks}
        sessionStarts={sessionStarts}
        bagEvent={bagEvent}
        onOffer={applyHealthOffer}
        onLandParentTask={landHealthTask}
        // UP-ATH-07 (2026-09-06): Say It to Someone picks from the people
        // this account already keeps, so the number that has to work in a
        // crisis is the one Contacts enrichment keeps fresh rather than a
        // second copy typed into a box. Everyone with a number, not just
        // this area's people: the adult you would call is not necessarily
        // filed under Health.
        people={allPeople.filter((p) => p.data.phone?.trim()).map((p) => ({ id: p.id, name: p.data.name, phone: p.data.phone!.trim() }))}
      />
    );
  }
  if (healthMore) {
    const groups = [...new Set(healthMoreRows.map((r) => r.group))];
    return (
      <div className="screen ruled health-ruled">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => setHealthMore(false)}></button>
          <div className="nav-title">{cat.data.name}</div>
        </div>
        <div className="nav-large">More</div>
        {groups.map((g) => (
          <div key={g}>
            <div className="sh2 sh2-quiet"><span className="t">{g}</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {healthMoreRows.filter((r) => r.group === g).map((r) => (
                <div {...pressable(() => setHealthDeep(r.key))} className="task-row p2" key={r.key}>
                  <div className="task-title">
                    <span className="task-name">{r.label}</span>
                    <div className="r-k"><span className="r-goal r-cat">{r.sub}</span></div>
                  </div>
                  {CHEV}
                </div>
              ))}
            </div></div>
          </div>
        ))}
        <div className="screen-foot" />
      </div>
    );
  }
  // Done, the Record, and the weekday insight now read the SAME log the
  // Pushed tile reads (2026-08-29, Brain wiring audit): one source, one cap,
  // numbers on this screen can no longer disagree with each other.
  const samples = completionSamples();
  const receipt = weekReceipt(categoryId, samples, events, today, cat.data.workHours ? work : null);
  // (The receipt sentence itself retired with the tinted tiles, 2026-09-02.)
  const ahLine = cat.data.workHours ? afterHoursLine(receipt) : null;
  // The Record (2026-08-10, Dave: "records and insight... tracking what
  // someone has done is important"). Named history that survives the Monday
  // reset, plus the week-over-week compare and the pattern in the data.
  const rec = categoryRecord(categoryId, samples, allTasks, today);
  // People-kind page derivations (2026-08-10).
  const bdayById = new Map(upcomingBirthdays(catPeople, today).map((b) => [b.id, b] as const));
  const nowMs = Date.now();
  // WHAT KEEPS HAPPENING HERE (2026-08-10, rewritten for BAN-1 2026-09-05).
  // This shipped as "N in a row · Best M" off runLen/bestRun, which is a run,
  // and the D1 ruling is a count, never a run: nothing resets, there is no
  // best to lose, a gap costs one day. It reads doneCount now, which
  // TasksService.toggleDone keeps the same idempotent-per-day way reminders
  // have kept theirs since D1. The alive gate went with the run: a count does
  // not go stale, so a fortnightly task that lapsed still says what it did.
  const repeats = allTasks
    .filter((t) => t.data.category === categoryId && t.data.recurrence && repetitionsLine(t.data.doneCount) !== null)
    .sort((a, b) => (b.data.doneCount ?? 0) - (a.data.doneCount ?? 0))
    .slice(0, 5);

  // Training summary (2026-08-25): the health page reads the gym without
  // opening it. Null on every other kind, and every row degrades to absent.
  const training = kind === "health" ? trainingSummary(workouts, today) : null;

  // S5-Q29 (2026-09-04): the four grafted loggers' rows, health-kind pages
  // only. Same "Logged <when>" phrasing agoPhrase already gives the training
  // summary above, so a fact about today reads the same everywhere on this
  // page. Call It's row also carries the number the screen itself already
  // shows in its own history (session-RPE, never a verdict on it).
  const healthLoggers: HealthLoggerRow[] = kind !== "health" ? [] : [
    { key: "lightsOut", label: "Lights Out", sub: lightsOut.length ? "Logged " + agoPhrase(localDayParts(lightsOut[lightsOut.length - 1]!.data.at).day, today) : null },
    { key: "tookIt", label: "Took It", sub: tookIt.length ? "Logged " + agoPhrase(localDayParts(tookIt[tookIt.length - 1]!.data.at).day, today) : null },
    { key: "callIt", label: "Call It", sub: callIt.length ? `Logged ${agoPhrase(localDayParts(callIt[callIt.length - 1]!.data.at).day, today)} · ${callIt[callIt.length - 1]!.data.rpe}/10` : null },
    { key: "pointAtIt", label: "Point at It", sub: pointAtIt.length ? "Logged " + agoPhrase(localDayParts(pointAtIt[pointAtIt.length - 1]!.data.at).day, today) : null },
  ];

  // D11-C/D13-A/C: the insight surfaces, health-kind pages only. Every piece
  // degrades to absent on its own (INSIGHT_MIN_PAIRED inside correlate(),
  // PLATEAU_MIN_SESSIONS inside plateauFlag(), zero-is-a-verdict inside
  // hardSetRows()) -- this block just gathers what already qualified.
  const activeDefs = kind === "health" ? activeMetrics(metricDefs) : [];
  const correlations = kind === "health"
    ? chartableExercises(workouts).flatMap((ex) => {
        const sessions = liftSessions(workouts, ex, ex.kind);
        return activeDefs
          .map((def) => correlate(sessions, ex.kind, ex.name, def, metricLogs))
          .filter((c): c is NonNullable<typeof c> => c != null);
      })
    : [];
  const plateaus = kind === "health"
    ? chartableExercises(workouts)
        .map((ex) => {
          const sessions = liftSessions(workouts, ex, ex.kind);
          const metricsFor = activeDefs.map((def) => ({ def, logs: metricLogs }));
          const flag = plateauFlag(sessions, ex.kind, ex, workouts, metricsFor);
          return flag ? { ...flag, name: ex.name } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p != null)
    : [];
  const muscleMap = kind === "health" ? muscleMapFromProgram(programs[0] ?? null) : new Map();
  const rangeRows = kind === "health" ? hardSetRows(workouts, muscleMap, nowMs) : [];
  const backOff = kind === "health" ? backOffSignal(workouts, nowMs) : null;
  const offerLighter = kind === "health" && shouldOfferLighterWeek(backOff);
  const hasInsights = plateaus.length > 0 || correlations.length > 0 || rangeRows.length > 0 || offerLighter;

  // Goals reaching this category through tags (Architecture C). The page
  // shows their pulse; Bigger Picture owns the goal itself. Health earns a
  // word only when the eye should catch it, the same law as the BP list.
  const goalIdx = buildGoalIndex(allProjects, liveGoals(goals));
  const goalsHere = (goalIdx.byCategory.get(categoryId) ?? [])
    .map((id) => goals.find((g) => g.id === id))
    .filter((g): g is Goal => !!g)
    .slice(0, 3)
    .map((g) => {
      const reach = reachOf(allTasks, allProjects, g);
      const ctx: MeasureContext = { reach, tasks: allTasks, projects: allProjects.filter((p) => p.data.goalId === g.id), samples, today, now: nowMs, workouts };
      const ms = measureState(g.data.measure, ctx);
      const h = healthOf(g, ms, g.data.measure, ctx, openWorkOf(reach));
      return {
        id: g.id, title: g.data.title, line: ms ? ms.line : reachLine(reach), flag: h === "behind" || h === "idle" ? h : null,
        // The ruled goal row's facts (the Health page, 2026-09-02): the
        // home colour, the capsule, the bar. Same words the Goals lens uses.
        tone: goalTone(g.data.tags),
        status: (h === "behind" || h === "idle") ? { text: HEALTH_LABEL[h], tone: "warn" as const }
          : (h === "on_track" || h === "done") ? { text: HEALTH_LABEL[h], tone: "good" as const } : null,
        bar: ms ? { done: ms.done, total: ms.target, pct: ms.pct } : reach.progress,
      };
    });

  // This Week's completion groups, capped until See All (2026-08-25): a busy
  // week was pushing Training below the fold.
  const dayGroups = groupByDay(rec.recent);
  const shownGroups = weekOpen ? dayGroups : dayGroups.slice(0, 2);

  // BRAIN-F-12 (2026-09-05): a check that failed used to fail silently, so
  // the row came back unchecked with nothing said. Same guard the deletes and
  // snoozes on this page already run through.
  const toggle = async (id: string) => { await attemptWrite(() => tasksSvc.toggleDone(id)); await reload(); };

  // THE SAME CLEARING AS EVERYWHERE (Dave 2026-09-02, the Health page's Up
  // Next: "the same clearing ability as well"). Delete with an Undo that
  // brings the task back, Tomorrow on the swipe, Start on the row: the
  // Tasks page's own three, with the same receipts.
  const deleteTask = async (id: string) => {
    const t = await tasksSvc.task(id);
    const ok = await attemptWrite(() => tasksSvc.deleteTask(id));
    await reload();
    if (ok && t) {
      showToast({
        message: "Task deleted",
        actionLabel: "Undo",
        onAction: async () => {
          await attemptWrite(() => tasksSvc.recreateFrom(t));
          await reload();
        },
      });
    }
  };
  const snoozeTask = async (id: string) => {
    // BRAIN-F-02 (2026-09-05): tomorrow used to be local midnight run
    // through toISOString(), which reads the UTC date and is still today
    // anywhere east of Greenwich. "Moved to tomorrow" then moved nothing.
    // addDays steps with setDate and formats from local getters.
    const tomorrow = addDays(today, 1);
    const ok = await attemptWrite(() => tasksSvc.setDue(id, tomorrow));
    await reload();
    if (ok) showToast({ message: "Moved to tomorrow" });
  };
  const startTask = async (id: string) => {
    const t = await tasksSvc.task(id);
    if (!t) return;
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const ok = await attemptWrite(() => schedule.createEvent(t.text, {
      date: today, start, end: addMinutes(start, FIFTEEN),
      category: t.category || undefined, sourceTaskId: id,
    }));
    if (ok) showToast({ message: `Fifteen minutes on ${t.text}` });
  };
  // The parent line every task row wears (life/parent.ts), from the same
  // three lists the Life tab reads.
  const parentIdx = buildParentIndex(allProjects, goals, allTasks, allEvents);

  // BRAIN-F-09 (2026-09-05): every sheet on this page latches its Save button
  // on the first tap, and none of these three writes was guarded, so a failed
  // one left "Saving" lit forever with the only exit throwing the edit away.
  // Each returns the boolean the sheet needs to unlatch, and closes only once
  // the write actually landed.
  const saveTask = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    const ok = await attemptWrite(() => tasksSvc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId, eventId: draft.eventId, steps: draft.steps }));
    if (!ok) return false;
    setSheet({ kind: "closed" });
    await reload();
    return true;
  };

  const dueLabel = (t: TaskItem): string | null => {
    const due = t.data.due;
    if (!due) return null;
    if (due < today) return "Overdue";
    const p = dayPhrase(due, today);
    return "Due " + (p === "today" || p === "tomorrow" ? p : p);
  };

  const sheetCats: SheetCategory[] = allCats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));

  // BRAIN-F-10 (option c, kept alongside a): what the delete costs, counted
  // before it happens and said on the armed step. Absent when nothing carries
  // this area, because "Untags 0 tasks" is noise.
  const deleteCost = (() => {
    const parts: string[] = [];
    const t = allTasks.filter((x) => isIn(x.data, categoryId)).length;
    const n = noteCount;
    const p = allProjects.filter((x) => x.data.category === categoryId).length;
    const pe = catPeople.length;
    if (t) parts.push(`${t} ${t === 1 ? "task" : "tasks"}`);
    if (n) parts.push(`${n} ${n === 1 ? "note" : "notes"}`);
    if (p) parts.push(`${p} ${p === 1 ? "project" : "projects"}`);
    if (pe) parts.push(`${pe} ${pe === 1 ? "person" : "people"}`);
    return parts.length ? capAfterNumber(`Untags ${parts.join(", ")}`) : null;
  })();

  // EVERY AREA PAGE SHOWS ALL FOUR, AND EVERY ONE HAS AN ADD (Dave 2026-09-09,
  // ruling it directly: "every single page that shows your categories shows
  // goals shows projects shows tasks it should show events and they should all
  // have an add button and that's it").
  // Held as one piece so a health area (which renders HealthBody instead of the
  // ordinary body) gets exactly the same four sections rather than a second
  // copy that drifts. Nothing here is gated on the area's kind or on the
  // section already holding something: every one stands, every one ends in its
  // own create row, and the count chip is the only thing that hides.
  const areaSections = (
    <>
      {/* EVERY AREA PAGE SHOWS ALL FOUR, AND EVERY ONE HAS AN ADD (Dave
          2026-09-09, ruling it directly: "every single page that shows your
          categories shows goals shows projects shows tasks it should show
          events and they should all have an add button and that's it").
          Projects used to be gated on the area being an ORG, which is why a
          plain area had no Projects section and no way to start one. The gate
          is gone: Projects, Goals Here, Coming Up and Up Next now stand on
          every area page whether or not they hold anything, each ending in its
          own create row. The count chip is the only thing that hides. */}
      {/* Project health, not a project list (2026-08-10, Dave: "make it
              more than just a list"). The Projects lens's own row: the pie
              in the area's colour, the state and what it moves on the
              second line, the next action under it, the week's count as a
              chip. A project with no open task says Stalled out loud. */}
          <div className="sh2 sh2-quiet"><span className="t">Projects</span>{projects.length > 0 && <span className="n">{projects.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">
            {projects.map((p) => {
              const next = nextActionOf(allTasks, p.id);
              const projTasks = allTasks.filter((t) => t.data.projectId === p.id);
              const taskIds = new Set(projTasks.map((t) => t.id));
              const weekAgoMs = nowMs - 7 * 86400000;
              const doneWeek = completionSamples().filter((s) => s.t >= weekAgoMs && s.id && taskIds.has(s.id)).length;
              const doneAll = projTasks.filter((t) => t.data.done).length;
              const pct = projTasks.length > 0 ? Math.round((doneAll / projTasks.length) * 100) : null;
              const overdue = projTasks.filter((t) => !t.data.done && !!t.data.due && t.data.due < today).length;
              // ONE GREY LINE (Dave 2026-09-02, from the area page: "way too
              // much sub grey text. Reformat it"). The title, then one line:
              // the next move, or the one word for a project that has none
              // (Paused, Stalled in the warning ink). The week's count and
              // any overdue ride as chips ahead of it; the goal it moves is
              // the Goals Here card two sections down, not a third line.
              const stalled = !next && p.data.status !== "on_hold";
              const line = next
                ? `Next: ${next.data.text}${next.data.due ? ` \u00b7 ${dayPhrase(next.data.due, today)}` : ""}`
                : p.data.status === "on_hold" ? "Paused" : "Stalled \u00b7 No next action";
              return (
                <div {...pressable(() => onOpenProject?.(p.id))} className="task-row p2 proj-row-ruled" key={p.id}>
                  <div className="task-check-tap"><span className={"pp-slot cat-fg-" + cat.data.color}><ProjectPie pct={pct} /></span></div>
                  <div className="task-title">
                    <span className="task-name">{p.data.title}</span>
                    <div className="r-k">
                      {doneWeek > 0 && <span className="uchip u-done">{doneWeek} done</span>}
                      {overdue > 0 && <span className="uchip u-late">{overdue} late</span>}
                      <span className={"r-goal r-cat" + (stalled ? " r-stalled" : "")}>{line}</span>
                    </div>
                  </div>
                  {CHEV}
                </div>
              );
            })}
            <button className="row-create" onClick={() => setSheet({ kind: "project" })}>Add Project</button>
          </div></div>

      {/* A GOAL STARTS WHERE IT LIVES (Dave 2026-09-09, from the Bridge area:
          "I should be able to add goals from the screen in the pic. I can with
          tasks and projects only").
          Projects and Up Next both end in their own create row, and this
          section had none -- and, worse, the whole section was gated on there
          already being a goal, so an area with none offered no door at all and
          the only way to start one was to leave for Bigger Picture and tag it
          back. The section now stands whether or not it holds anything, the
          way Projects does, and the count chip is what hides when it is empty.
          A goal reaches an area through its TAGS (reach.ts's byCategory), so
          the new goal opens already tagged with this one; the sheet still
          shows the tag, so it can be changed or joined by another before it
          saves. Nothing about how a goal is stored moves: this is the same
          GoalSheet Bigger Picture opens, with the area filled in. */}
      <div className="sh2 sh2-quiet"><span className="t">Goals Here</span>{goalsHere.length > 0 && <span className="n">{goalsHere.length}</span>}</div>
      {/* B3-5 (2026-09-04): the project rows above open; these had no
          onOpen at all, so GoalRowRuled (gated on that prop) never
          rendered a role, a handler or the chevron. */}
      <div className="pad-x"><div className="card list-card-ruled">
        {goalsHere.map((g) => (
          <GoalRowRuled key={g.id} title={g.title} tone={g.tone} body={g.line} status={g.status} bar={g.bar}
            onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined} />
        ))}
        <button className="row-create" onClick={() => setSheet({ kind: "goal" })}>Add Goal</button>
      </div></div>

      {/* WHAT IS ON THE CALENDAR FOR THIS PART OF LIFE (Dave 2026-09-09:
          "there's also no events section on these pages").
          There was one, and two things were wrong with it: it was gated on
          this area already HAVING an event, so an area with none showed
          nothing and offered no way to make one, and it sat below Up Next,
          Notes and People, which is under the fold on every phone. An event is
          the most time-bound thing an area owns, so it goes above the task
          list, and it stands whether or not it holds anything, the way
          Projects and Goals Here now do.
          The rows stay read-only and the Schedule tab still owns editing;
          Add Event opens the same EventSheet it does, with the area filled
          in. comingUpFor walks the days through occursOn, so a weekly
          practice shows its NEXT date rather than being dropped for having an
          anchor in the past (BRAIN-F-07). */}
      <div className="sh2 sh2-quiet"><span className="t">Coming Up</span>{upcoming.length > 0 && <span className="n">{upcoming.length}</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled sched-card"><div className="sched-list">
        {upcoming.map((e) => {
          const p = dayPhrase(e.date, today);
          const when = p.charAt(0).toUpperCase() + p.slice(1);
          const t = e.start ? fmtTime(e.start) : null;
          return (
            <div className="sched-row" key={e.id}>
              <div className="sched-time">{t ? <>{t.time}<span className="ampm">{t.ap}</span></> : <span className="ampm">All day</span>}</div>
              <div className="sched-body">
                <div className="sched-title">{e.title}</div>
                <div className="sched-cat"><span className={"cat-dot cat-bg-" + cat.data.color} />{cat.data.name}<span className="sched-sep">{"\u00b7"}</span>{when}</div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="row-create" onClick={() => setSheet({ kind: "event" })}>Add Event</button>
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">Up Next</span>{open.length > 0 && <span className="n">{open.length}</span>}</div>
      {/* THE SAME ROW AS EVERYWHERE (Dave 2026-09-02, on the Health page:
          "should render as a task there like it does everywhere else. It
          should have the same clearing ability as well"). */}
      <div className="pad-x"><div className="card list-card-ruled">
        {open.map((t) => {
          const rem = t.data.reminder?.time;
          return (
            <TaskRow
              key={t.id}
              item={t}
              today={today}
              kicker={t.data.reminder && rem ? `${fmtTime(rem).time} ${fmtTime(rem).ap}` : null}
              parent={parentForTask(parentIdx, t)}
              onToggle={(id) => void toggle(id)}
              onOpen={onOpenTask}
              onDelete={(id) => void deleteTask(id)}
              onSnooze={t.data.reminder ? undefined : (id) => void snoozeTask(id)}
              onStart={t.data.reminder ? undefined : (id) => void startTask(id)}
            />
          );
        })}
        <button className="row-create" onClick={() => setSheet({ kind: "task" })}>Add Task</button>
      </div></div>
    </>
  );

  return (
    // THE HEALTH PAGE WEARS THE RULINGS (2026-09-02, Check, Health, Stop):
    // glass cards, quiet caps heads, ruled rows, and its own composition
    // (HealthBody). The gym's own screens wear the rulings too now (the
    // training skin retired 2026-09-03). Other categories keep the app's
    // default card.
    <div className={"screen ruled" + (kind === "health" ? " health-ruled" : " area-ruled")}>
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title"><span className={"cat-dot cat-bg-" + cat.data.color} /> {cat.data.name}</div>
        <button className="nav-action-text" onClick={() => setSheet({ kind: "edit" })}>Edit</button>
      </div>

      {paused && (
        <div className="pad-x"><div className="card">
          <div className="row">
            <div className="row-grow"><div className="conn-name">Paused for Now</div></div>
            {/* BRAIN-F-12 (2026-09-05): Wake Up did nothing and said nothing
                when the write failed; the banner just stayed. */}
            <button className="btn-sm" onClick={async () => { const ok = await attemptWrite(() => catsSvc.update(categoryId, { season: undefined })); if (!ok) return; onChanged?.(); await reload(); }}>Wake Up</button>
          </div>
        </div></div>
      )}

      {kind === "health" ? (
        <HealthBody
          program={programs[0] ?? null}
          workouts={workouts}
          training={training}
          today={today}
          isEvening={new Date().getHours() >= 17}
          gymEvent={gymDoor ? { start: gymDoor.start } : null}
          metricDefs={metricDefs}
          metricLogs={metricLogs}
          goals={goalsHere.map((g): HealthGoalRow => ({ id: g.id, title: g.title, tone: g.tone, body: g.line, status: g.status, bar: g.bar }))}
          onAddGoal={() => setSheet({ kind: "goal" })}
          onOpenGoal={onOpenGoal}
          tasks={open}
          // A reminder's second line is its time; a task's is its parent.
          kickerOf={(t) => { const rem = t.data.reminder?.time; return t.data.reminder && rem ? `${fmtTime(rem).time} ${fmtTime(rem).ap}` : null; }}
          parentOf={(t) => parentForTask(parentIdx, t)}
          onStart={(dayId) => { setGymStartDay(dayId); setGymOpen(true); }}
          onOpenGym={() => setGymOpen(true)}
          onOpenMetric={(def) => setMetricSheet({ kind: "log", def })}
          onManageMetrics={() => setMetricSheet({ kind: "add" })}
          healthLoggers={healthLoggers}
          onOpenHealthLogger={(key) => setHealthScreen(key)}
          // HMN-F-06: Student only, and absent rather than disabled.
          onOpenHealthMore={healthMoreRows.length > 0 ? () => setHealthMore(true) : undefined}
          onToggleTask={(id) => void toggle(id)}
          onOpenTask={onOpenTask}
          onDeleteTask={(id) => void deleteTask(id)}
          onSnoozeTask={(id) => void snoozeTask(id)}
          onStartTask={(id) => void startTask(id)}
          onAddTask={() => setSheet({ kind: "task" })}
          insights={hasInsights ? (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Insights</span></div>
              <div className="pad-x">
                {plateaus.map((p) => (
                  <div className="card rep-gap banner-warn" key={"plateau-" + p.name}>
                    <div className="row">
                      <div className="row-grow">
                        <div className="conn-name">{capAfterNumber(`${p.name} · ${p.flatSessions} sessions with no new best`)}</div>
                        <div className="conn-meta">Best was {p.peakValue} on {p.peakDate} · Now {p.currentValue}</div>
                      </div>
                    </div>
                    {p.whatChanged.map((r) => (
                      <div className="row" key={r.label}>
                        <div className="row-grow"><div className="conn-name">{r.label}</div></div>
                        <div className="conn-meta">{r.moving}{r.unit ? ` ${r.unit}` : ""} to {r.flat}{r.unit ? ` ${r.unit}` : ""}</div>
                      </div>
                    ))}
                    <div className="row"><div className="row-grow"><div className="conn-meta">Correlation, not cause</div></div></div>
                  </div>
                ))}
                {correlations.map((c) => (
                  <div className="card pad rep-gap banner-blue" key={c.exerciseName + "-" + c.metricName}>
                    <div className="conn-name">{c.exerciseName} × {c.metricName}</div>
                    <div className="conn-meta">{c.line}</div>
                  </div>
                ))}
                {rangeRows.map((r) => (
                  <div className="card rep-gap" key={r.muscle}>
                    <div className="row">
                      <div className="row-grow"><div className="conn-name">{MUSCLE_LABEL[r.muscle]} · {r.sets} sets this week</div><div className="conn-meta">{r.range.note}</div></div>
                    </div>
                    <div className="row"><div className="row-grow"><div className="conn-meta">{r.range.source}</div></div></div>
                  </div>
                ))}
                {offerLighter && (
                  <div className="card pad rep-gap banner-warn">
                    <div className="conn-name">A Lighter Week, If You Want It</div>
                    <div className="conn-meta">Several grinds and misses lately · Never a prescription, just an offer</div>
                  </div>
                )}
              </div>
            </>
          ) : null}
          more={
            <>
              {repeats.length > 0 && (
                <>
                  <div className="sh2 sh2-quiet"><span className="t">Repetitions</span><span className="n">{repeats.length}</span></div>
                  <div className="pad-x"><div className="card list-card-ruled">
                    {repeats.map((t) => (
                      <div className="task-row p2" key={t.id}>
                        <div className="task-title">
                          <span className="task-name">{t.data.text}</span>
                          <div className="r-k"><span className="r-goal r-cat">{repetitionsLine(t.data.doneCount)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div></div>
                </>
              )}
              {rec.recent.length > 0 && (
                <>
                  <div className="sh2 sh2-quiet"><span className="t">This Week</span><span className="n">{rec.recent.length}</span>
                    {!weekOpen && dayGroups.length > 2 && <button className="see-all pill-action" onClick={() => setWeekOpen(true)}>See All</button>}</div>
                  <div className="pad-x">
                    {shownGroups.map((g) => (
                      <div key={g.day}>
                        <DayDivide label={g.day} />
                        <div className="card list-card-ruled">
                          {g.rows.map((r) => (
                            <div className="task-row p2" key={r.key}>
                              <div className="task-check-tap"><div className="task-check done" /></div>
                              <div className="task-title"><span className="task-name">{r.text}</span></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {notes.length > 0 && (
                <>
                  <div className="sh2 sh2-quiet"><span className="t">Notes</span><span className="n">{notes.length}</span></div>
                  <div className="pad-x"><div className="card list-card-ruled">
                    {notes.map((n) => (
                      <div {...pressable(() => onOpenNote?.(n.id))} className="task-row p2" key={n.id}>
                        <div className="task-title"><span className="task-name">{n.title}</span></div>
                        {CHEV}
                      </div>
                    ))}
                  </div></div>
                </>
              )}
            </>
          }
        />
      ) : null}
      {kind === "health" && areaSections}
      {kind !== "health" && (
        <>
      {/* THE AREA PAGE WEARS THE RULINGS (Brain onto the rulings, Dave
          2026-09-02, picked "Today's own tiles, then the receipt" and "The
          quiet caps head every ruled page wears"). Under the name: the home
          page's quiet number tiles, each earning its place with a real
          number (zeros go silent, 2026-08-25), then This Week as a card of
          done rows under one day divider each. Then the quiet caps head
          every ruled page wears over the rows the rest of the app already
          has: the Schedule's event row, the Projects lens's pie row, the
          goal row, the task row with its check and swipe, the note row. The
          filled section tiles and the tinted stat tiles are gone. */}
      {(receipt.done > 0 || receipt.events > 0 || pushedWeek > 0 || rec.lastWeek > 0) && (
        <div className="pad-x"><div className="stat-tiles area-tiles">
          {receipt.done > 0 && <span className="stat-tile st-quiet"><span className="st-n">{receipt.done}</span><span className="st-w">done</span></span>}
          {receipt.events > 0 && <span className="stat-tile st-time"><span className="st-n">{receipt.events}</span><span className="st-w">{receipt.events === 1 ? "event" : "events"}</span></span>}
          {pushedWeek > 0 && <span className="stat-tile st-warn"><span className="st-n">{pushedWeek}</span><span className="st-w">pushed</span></span>}
          {rec.lastWeek > 0 && <span className="stat-tile st-quiet"><span className="st-n">{(receipt.done - rec.lastWeek >= 0 ? "+" : "") + (receipt.done - rec.lastWeek)}</span><span className="st-w">vs last week</span></span>}
        </div></div>
      )}
      {(ahLine || rec.insight) && (
        <div className="pad-x"><div className="area-facts">
          {ahLine && <div className="area-fact">{ahLine}</div>}
          {rec.insight && <div className="area-fact">{rec.insight}</div>}
        </div></div>
      )}
      {rec.recent.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">This Week</span><span className="n">{rec.recent.length}</span>
            {!weekOpen && dayGroups.length > 2 && <button className="see-all pill-action" onClick={() => setWeekOpen(true)}>See All</button>}</div>
          <div className="pad-x">
            {shownGroups.map((g) => (
              <div key={g.day}>
                <DayDivide label={g.day} />
                <div className="card list-card-ruled">
                  {g.rows.map((r) => (
                    <div className="task-row p2" key={r.key}>
                      <div className="task-check-tap"><div className="task-check done" /></div>
                      <div className="task-title"><span className="task-name">{r.text}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {repeats.length > 0 && (
        <>
          {/* What keeps happening here: how many times this category's
              recurring work has actually been done. Scoreboard, not a to-do
              list, and a count rather than a run (BAN-1). */}
          <div className="sh2 sh2-quiet"><span className="t">Repetitions</span><span className="n">{repeats.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {repeats.map((t) => (
              <div className="task-row p2" key={t.id}>
                <div className="task-title">
                  <span className="task-name">{t.data.text}</span>
                  <div className="r-k"><span className="r-goal r-cat">{repetitionsLine(t.data.doneCount)}</span></div>
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {(kind === "people" || (isOrg && catPeople.length > 0)) && (
        <>
          {/* The point of a Family page is the family (2026-08-10, Dave:
              "actual features with real value not a place for tasks"). The
              people tagged to this category, with the two facts a person page
              can act on: a birthday coming, and how long since you talked
              (derived from Gmail when connected, silent when not). Orgs get
              the same section when they have tagged people (clients, a team);
              on an org it stays hidden while empty instead of nagging. */}
          <div className="sh2 sh2-quiet"><span className="t">{isOrg ? "People" : "Your People"}</span>{catPeople.length > 0 && <span className="n">{catPeople.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">
            {catPeople.length === 0 && (
              <div className="task-row p2">
                <div className="task-title">
                  <span className="task-name">No People Here Yet</span>
                  <div className="r-k"><span className="r-goal r-cat">Open someone in Contacts and tag them {cat.data.name}</span></div>
                </div>
              </div>
            )}
            {catPeople.map((p) => {
              const bday = bdayById.get(p.id);
              const last = contact[p.id];
              const wrow = waitingBy[p.id];
              const quiet = last != null && isQuiet(last, nowMs);
              const bits: string[] = [];
              if (p.data.relationship) bits.push(p.data.relationship);
              if (bday) bits.push(bday.inDays === 0 ? "Birthday today" : bday.inDays === 1 ? "Birthday tomorrow" : `Birthday ${bday.label}`);
              else if (wrow) bits.push(wrow.waitingDays === 1 ? "Waiting on their reply · 1 day" : `Waiting on their reply · ${wrow.waitingDays} days`);
              else if (quiet) bits.push(`Gone quiet: last talked ${agoLabel(last, nowMs)}`);
              else if (last != null) bits.push(`Last talked ${agoLabel(last, nowMs)}`);
              const nudgeable = !!p.data.email && (quiet || !!wrow);
              return (
                <div {...pressable(() => onOpenPerson?.(p.id))} className="task-row p2 person-row-ruled" key={p.id}>
                  <div className="task-check-tap"><div className={"av " + avatarClass(p.data.color)}>{personInitials(p.data.name)}</div></div>
                  <div className="task-title">
                    <span className="task-name">{p.data.name}</span>
                    {bits.length > 0 && <div className="r-k"><span className="r-goal r-cat">{bits.join(" · ")}</span></div>}
                  </div>
                  {nudgeable ? (
                    <button className="pill-act" disabled={nudging === p.id}
                      onClick={(e) => { e.stopPropagation(); void nudge(p); }}>
                      {nudging === p.id ? "Drafting" : "Nudge"}
                    </button>
                  ) : CHEV}
                </div>
              );
            })}
            {onOpenContacts && (
              <button className="row row-act" onClick={onOpenContacts}>Open Contacts</button>
            )}
          </div></div>
        </>
      )}



      {areaSections}

      {notes.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Notes</span><span className="n">{notes.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {notes.map((n) => (
              <div {...pressable(() => onOpenNote?.(n.id))} className="task-row p2 note-row" key={n.id}>
                <div className="task-title"><span className="task-name">{n.title}</span></div>
                {CHEV}
              </div>
            ))}
          </div></div>
        </>
      )}
        </>
      )}
      <div className="screen-foot" />

      {sheet.kind === "task" && (
        <TaskSheet mode="new" categories={sheetCats} events={sheetEvents(allEvents, today)} initial={{ category: categoryId }} onSave={saveTask} onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "project" && (
        <ProjectSheet mode="new" categories={allCats} goals={goals} initial={{ category: categoryId }}
          onSave={async (d) => {
            const ok = await attemptWrite(() => projectsSvc.create(d));
            if (!ok) return false;
            setSheet({ kind: "closed" });
            await reload();
            return true;
          }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "event" && (
        <EventSheet
          mode="new"
          categories={sheetCats}
          initial={{ date: today, category: categoryId }}
          onSave={async (d) => {
            const ok = await attemptWrite(() => schedule.createEvent(d.title, {
              date: d.date, start: d.start, end: d.end || undefined, category: d.category,
              location: d.location || undefined, recurrence: d.recurrence === "none" ? undefined : d.recurrence,
            }));
            if (!ok) return false;
            setSheet({ kind: "closed" });
            await reload();
            return true;
          }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "goal" && (
        <GoalSheet mode="new" categories={allCats} initial={{ title: "", state: "on_track", tags: [categoryId] }}
          onSave={async (d) => {
            const ok = await attemptWrite(() => goalsSvc.create(d));
            if (!ok) return false;
            setSheet({ kind: "closed" });
            await reload();
            return true;
          }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "edit" && (
        <CategorySheet mode="edit"
          initial={{ name: cat.data.name, color: cat.data.color, icon: cat.data.icon ?? "folder", kind: cat.data.kind, season: cat.data.season, workHours: cat.data.workHours }}
          onSave={async (d: CategoryDraft) => {
            const ok = await attemptWrite(() => catsSvc.update(categoryId, { name: d.name, color: d.color, icon: d.icon, kind: d.kind, season: d.season, workHours: d.workHours }));
            if (!ok) return false;
            setSheet({ kind: "closed" });
            onChanged?.();
            await reload();
            return true;
          }}
          // BRAIN-F-10 (2026-09-05, fork option A): Undo restores the area
          // under its ORIGINAL id, so every task, note, event, project and
          // person that carried it is tagged again and the org's Paused /
          // Work Hours settings and its kind come back with it. create()
          // minted a new id and took three fields, which is why the area used
          // to return empty.
          deleteCost={deleteCost}
          onDelete={async () => {
            const gone = cat ? { ...cat.data } : null;
            const ok = await attemptWrite(() => catsSvc.remove(categoryId));
            if (!ok) return;
            onChanged?.();
            onBack();
            showToast({
              message: "Area deleted",
              actionLabel: "Undo",
              onAction: async () => {
                if (gone) await attemptWrite(() => catsSvc.restore(categoryId, gone));
                onChanged?.();
              },
            });
          }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}

      {metricSheet?.kind === "log" && (() => {
        const existingLog = metricLogs.find((l) => l.data.metricId === metricSheet.def.id && l.data.date === today);
        return (
          <MetricLogSheet
            def={metricSheet.def}
            date={today}
            initial={existingLog}
            onSave={(value) => void metricWrite(() => metricsSvc.logMetric(metricSheet.def.id, today, value), () => setMetricSheet(null))}
            // B3-8 (2026-09-04): removeLog existed, tested, with no caller.
            // Undo re-logs the same value, matching every other delete's Undo.
            // BRAIN-F-15 (2026-09-05): the receipt lives INSIDE metricWrite's
            // success callback. Outside it, a failed delete showed both
            // "Log deleted · Undo" and "Couldn't save that metric", and the
            // Undo then re-logged a value that had never been removed.
            onDelete={existingLog ? () => {
              const kept = { ...existingLog.data };
              void metricWrite(() => metricsSvc.removeLog(existingLog.id), () => {
                setMetricSheet(null);
                showToast({
                  message: "Log deleted",
                  actionLabel: "Undo",
                  onAction: () => void metricWrite(() => metricsSvc.logMetric(kept.metricId, kept.date, { value: kept.value, yes: kept.yes })),
                });
              });
            } : undefined}
            onCancel={() => setMetricSheet(null)}
          />
        );
      })()}
      {metricSheet?.kind === "add" && (
        <AddMetricSheet
          defs={metricDefs}
          onEnablePreset={(preset) => void metricWrite(() => metricsSvc.createDef(newMetricDefData(preset.name, preset.type, preset.unit, preset.key, today, metricDefs.length)))}
          onToggleHidden={(def) => void metricWrite(() => metricsSvc.updateDef(def.id, { hidden: !def.data.hidden }))}
          onCreateCustom={(name, type, unit) => void metricWrite(() => metricsSvc.createDef(newMetricDefData(name, type, unit || undefined, undefined, today, metricDefs.length)))}
          // THE DAILY PULSE (handoff item 11, option A). One tap turns on the
          // four the pulse is made of. pulsePlan splits the work because "not
          // on" is two different states: a key with an existing def is
          // un-hidden and keeps its logged history, and only a key with no def
          // at all is created. Creating a second def for a hidden one would
          // strand the first one's history, which is the opposite of HIDE,
          // NEVER DELETE.
          onEnablePulse={() => void metricWrite(async () => {
            const plan = pulsePlan(metricDefs);
            let order = metricDefs.length;
            for (const d of plan.unhide) await metricsSvc.updateDef(d.id, { hidden: false });
            for (const p of plan.create) await metricsSvc.createDef(newMetricDefData(p.name, p.type, p.unit, p.key, today, order++));
            return true;
          })}
          onCancel={() => setMetricSheet(null)}
        />
      )}
    </div>
  );
}
