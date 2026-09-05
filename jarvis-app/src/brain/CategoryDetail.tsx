import { isIn } from "../tasks/categories";
import { useCallback, useEffect, useState } from "react";
import { useTasks, useSchedule, useNotes, useCategories, useProjects, useGoals, useRoutine, usePeople } from "../data/NotesProvider";
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
import { streakAlive } from "../tasks/lifecycle";
import { effectiveKind } from "../categories/kinds";
import { weekReceipt, afterHoursLine, type WeekEvent } from "../categories/receipts";
import { categoryRecord, type RecordEntry } from "../categories/record";
import { DayDivide } from "../shared/anatomy";
import { eventLog } from "../events";
import { completionSamples } from "../events/completions";
import { todayISO } from "../tasks/grouping";
import { nextActionOf } from "../bigger/related";
import { dayPhrase } from "../money/bills";
import { fmtTime, addMinutes } from "../schedule/calendar";
import { FIFTEEN } from "../tasks/rightNow";
import { attemptWrite } from "../shared/guard";
import { buildParentIndex, parentForTask } from "../life/parent";
import TaskSheet, { type SheetCategory, type TaskDraft } from "../tasks/screens/TaskSheet";
import ProjectSheet from "../projects/ProjectSheet";
import CategorySheet, { type CategoryDraft } from "../categories/screens/CategorySheet";
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
import { tookItTimeline, stillThere } from "../health/timelines";
import { telHref, CRISIS_LINE_NUMBER } from "../health/trustedAdult";
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

type SheetState = { kind: "closed" } | { kind: "task" } | { kind: "project" } | { kind: "edit" };


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
  // session is waiting -- this is a fresh mount every time (BrainFlow keys
  // its detail pane by category id), so seeding gymOpen's initial value is
  // enough; nothing needs to reset it back off.
  autoOpenGym?: boolean;
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
  const [events, setEvents] = useState<WeekEvent[]>([]);
  // Full event rows for the Coming Up section (WeekEvent above is the thin
  // shape the receipt needs; this keeps titles and times).
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; date: string; start: string }[]>([]);
  // The people in this category (person.categoryIds, set from the person's
  // own card). Written since the person-pass; READ for the first time here.
  const [catPeople, setCatPeople] = useState<Person[]>([]);
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
  const [healthScreen, setHealthScreen] = useState<HealthLoggerKey | null>(null);
  const [lightsOut, setLightsOut] = useState<LightsOutEntry[]>([]);
  const [tookIt, setTookIt] = useState<TookItEntry[]>([]);
  const [callIt, setCallIt] = useState<CallItEntry[]>([]);
  const [pointAtIt, setPointAtIt] = useState<PointAtItEntry[]>([]);
  // Full project list, unfiltered: goal reach is computed across ALL
  // projects (a goal tagged here can be filed anywhere).
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  // This Week's day groups start capped; See All opens the rest.
  const [weekOpen, setWeekOpen] = useState(false);
  const today = todayISO();

  const reload = useCallback(async () => {
    const [c, cs, tk, pj, gl, nt, ev, rt, ppl] = await Promise.all([
      catsSvc.get(categoryId),
      catsSvc.list(),
      tasksSvc.listTasks(),
      projectsSvc.list(),
      goalsSvc.list(),
      notesSvc.listNotes(),
      schedule.listEvents(),
      routine.get(),
      peopleSvc.list(),
    ]);
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
    setNotes(
      tk && nt
        ? nt.filter((n) => (n.data as unknown as NoteData).category === categoryId)
            .slice(0, NOTES_CAP)
            .map((n) => ({ id: n.id, title: ((n.data as unknown as NoteData).title || "Untitled") }))
        : [],
    );
    setEvents(ev.map((e) => ({ date: e.data.date, start: e.data.start, category: e.data.category })));
    const nowIso = todayISO();
    setUpcoming(
      ev.filter((e) => e.data.category === categoryId && e.data.date >= nowIso)
        .sort((a, b) => (a.data.date + a.data.start).localeCompare(b.data.date + b.data.start))
        .slice(0, 4)
        .map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, start: e.data.start })),
    );
    setCatPeople(ppl.filter((p) => (p.data.categoryIds ?? []).includes(categoryId)));
    // Pushed-forward count for the week (2026-08-10): the receipt told half
    // the story (what got done); this is the honest other half, read from the
    // same local event log the pushes already write to.
    const weekAgo = Date.now() - 7 * 86400000;
    setPushedWeek(eventLog.all().filter((e) => e.type === "task.pushed" && e.ts >= weekAgo && e.props?.category === categoryId).length);
    setWork(rt ? { startMin: rt.workStartMin, endMin: rt.workEndMin } : null);
  }, [catsSvc, tasksSvc, projectsSvc, goalsSvc, notesSvc, schedule, routine, peopleSvc, categoryId]);

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
  // upcoming already carries the id gymEvent below reads .start from.
  if (gymOpen) return <GymFlow startDayId={gymStartDay ?? undefined} startDoorEventId={upcoming.find((x) => x.date === today && x.start)?.id} onBack={() => { setGymOpen(false); setGymStartDay(null); void reload(); }} />;
  // S5-Q29: the four grafted Health screens, unmodified from the dormant
  // module -- they were always presentational (props in, callbacks out),
  // never wired to a store of their own. onBack just closes the screen;
  // the effect above already refetches everything on that same dep.
  if (healthScreen === "lightsOut") {
    return (
      <LightsOutScreen
        last={lightsOut[lightsOut.length - 1] ?? null}
        onLog={() => { healthSvc.logLightsOut(); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "tookIt") {
    return (
      <TookItScreen
        timeline={tookItTimeline(tookIt)}
        onLog={() => { healthSvc.logTookIt(); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "callIt") {
    return (
      <CallItScreen
        history={callIt.map((e) => ({ at: e.data.at, rpe: e.data.rpe, durationMin: e.data.durationMin }))}
        onLog={(rpe) => { healthSvc.logCallIt({ rpe }); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  if (healthScreen === "pointAtIt") {
    return (
      <PointAtItScreen
        patterns={stillThere(pointAtIt)}
        onLog={(x, y, side) => { healthSvc.logPointAtIt({ x, y, side }); }}
        // Point at It's own "Still There?" affordance, still honest: not the
        // full Say It to Someone / trusted-adult screen (that stays dormant
        // with Ate Before), but the one number this module always has,
        // straight to a real line.
        onHandToSomeone={() => { window.location.href = telHref(CRISIS_LINE_NUMBER); }}
        onBack={() => setHealthScreen(null)}
      />
    );
  }
  const kind = effectiveKind(cat.data);
  const isOrg = kind === "org";
  const paused = isOrg && cat.data.season === "paused";
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
  // Streaks (2026-08-10): recurring tasks in this category that are actually
  // running. The data (runLen/bestRun) has been maintained since the ADHD
  // lifecycle work; the page never showed it. streakAlive is the gate
  // (2026-08-25): runLen only changes on completion, so without it a run
  // that ended months ago still displayed as current.
  const streaks = allTasks
    .filter((t) => t.data.category === categoryId && t.data.recurrence && (t.data.runLen ?? 0) >= 2 && streakAlive(t.data, today))
    .sort((a, b) => (b.data.runLen ?? 0) - (a.data.runLen ?? 0))
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
        const sessions = liftSessions(workouts, ex.name, ex.kind);
        return activeDefs
          .map((def) => correlate(sessions, ex.kind, ex.name, def, metricLogs))
          .filter((c): c is NonNullable<typeof c> => c != null);
      })
    : [];
  const plateaus = kind === "health"
    ? chartableExercises(workouts)
        .map((ex) => {
          const sessions = liftSessions(workouts, ex.name, ex.kind);
          const metricsFor = activeDefs.map((def) => ({ def, logs: metricLogs }));
          const flag = plateauFlag(sessions, ex.kind, ex.name, workouts, metricsFor);
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

  const toggle = async (id: string) => { await tasksSvc.toggleDone(id); await reload(); };

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
    const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 1);
    const tomorrow = d.toISOString().slice(0, 10);
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
  const parentIdx = buildParentIndex(allProjects, goals, allTasks);

  const saveTask = async (draft: TaskDraft) => {
    const rec = (draft.repeat || "") as "" | Recurrence;
    await tasksSvc.createTask(draft.text, { category: draft.category || undefined, due: draft.due || null, recurrence: rec || undefined, projectId: draft.projectId, steps: draft.steps });
    setSheet({ kind: "closed" });
    await reload();
  };

  const dueLabel = (t: TaskItem): string | null => {
    const due = t.data.due;
    if (!due) return null;
    if (due < today) return "Overdue";
    const p = dayPhrase(due, today);
    return "Due " + (p === "today" || p === "tomorrow" ? p : p);
  };

  const sheetCats: SheetCategory[] = allCats.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));

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
            <button className="btn-sm" onClick={async () => { await catsSvc.update(categoryId, { season: undefined }); onChanged?.(); await reload(); }}>Wake Up</button>
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
          gymEvent={(() => { const e = upcoming.find((x) => x.date === today && x.start); return e ? { start: e.start } : null; })()}
          metricDefs={metricDefs}
          metricLogs={metricLogs}
          goals={goalsHere.map((g): HealthGoalRow => ({ id: g.id, title: g.title, tone: g.tone, body: g.line, status: g.status, bar: g.bar }))}
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
              {streaks.length > 0 && (
                <>
                  <div className="sh2 sh2-quiet"><span className="t">Streaks</span><span className="n">{streaks.length}</span></div>
                  <div className="pad-x"><div className="card list-card-ruled">
                    {streaks.map((t) => (
                      <div className="task-row p2" key={t.id}>
                        <div className="task-title">
                          <span className="task-name">{t.data.text}</span>
                          <div className="r-k"><span className="r-goal r-cat">{capAfterNumber(`${t.data.runLen} in a row${(t.data.bestRun ?? 0) > (t.data.runLen ?? 0) ? ` · Best ${t.data.bestRun}` : (t.data.runLen ?? 0) >= 3 ? " · Your best" : ""}`)}</span></div>
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
                      <div className="task-row p2" role="button" tabIndex={0} key={n.id} onClick={() => onOpenNote?.(n.id)}>
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
      ) : (
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

      {streaks.length > 0 && (
        <>
          {/* What keeps happening here: live streaks on this category's
              recurring tasks. Scoreboard, not a to-do list. */}
          <div className="sh2 sh2-quiet"><span className="t">Streaks</span><span className="n">{streaks.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {streaks.map((t) => (
              <div className="task-row p2" key={t.id}>
                <div className="task-title">
                  <span className="task-name">{t.data.text}</span>
                  <div className="r-k"><span className="r-goal r-cat">{capAfterNumber(`${t.data.runLen} in a row${(t.data.bestRun ?? 0) > (t.data.runLen ?? 0) ? ` · Best ${t.data.bestRun}` : (t.data.runLen ?? 0) >= 3 ? " · Your best" : ""}`)}</span></div>
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
                <div className="task-row p2 person-row-ruled" role="button" tabIndex={0} key={p.id} onClick={() => onOpenPerson?.(p.id)}>
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

      {upcoming.length > 0 && (
        <>
          {/* What is on the calendar for this part of life. Read-only rows on
              purpose: the schedule tab owns editing. The Schedule's own row:
              the time in its column, the title, the day under it. */}
          <div className="sh2 sh2-quiet"><span className="t">Coming Up</span><span className="n">{upcoming.length}</span></div>
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
          </div></div></div>
        </>
      )}

      {isOrg && (
        <>
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
                <div className="task-row p2 proj-row-ruled" role="button" tabIndex={0} key={p.id} onClick={() => onOpenProject?.(p.id)}>
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
        </>
      )}

      {goalsHere.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Goals Here</span><span className="n">{goalsHere.length}</span></div>
          {/* B3-5 (2026-09-04): the project rows above open; these had no
              onOpen at all, so GoalRowRuled (gated on that prop) never
              rendered a role, a handler or the chevron. */}
          <div className="pad-x"><div className="card list-card-ruled">
            {goalsHere.map((g) => (
              <GoalRowRuled key={g.id} title={g.title} tone={g.tone} body={g.line} status={g.status} bar={g.bar}
                onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined} />
            ))}
          </div></div>
        </>
      )}

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

      {notes.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Notes</span><span className="n">{notes.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {notes.map((n) => (
              <div className="task-row p2 note-row" role="button" tabIndex={0} key={n.id} onClick={() => onOpenNote?.(n.id)}>
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
        <TaskSheet mode="new" categories={sheetCats} initial={{ category: categoryId }} onSave={saveTask} onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "project" && (
        <ProjectSheet mode="new" categories={allCats} goals={goals} initial={{ category: categoryId }}
          onSave={async (d) => { await projectsSvc.create(d); setSheet({ kind: "closed" }); await reload(); }}
          onCancel={() => setSheet({ kind: "closed" })} />
      )}
      {sheet.kind === "edit" && (
        <CategorySheet mode="edit"
          initial={{ name: cat.data.name, color: cat.data.color, icon: cat.data.icon ?? "folder", kind: cat.data.kind, season: cat.data.season, workHours: cat.data.workHours }}
          onSave={async (d: CategoryDraft) => {
            await catsSvc.update(categoryId, { name: d.name, color: d.color, icon: d.icon, kind: d.kind, season: d.season, workHours: d.workHours });
            setSheet({ kind: "closed" });
            onChanged?.();
            await reload();
          }}
          onDelete={async () => {
            // Undo restores the category itself (new id); items that pointed
            // at the old id stay untagged either way, which the toast owns up
            // to by naming the delete rather than pretending it was free.
            const gone = cat ? { ...cat.data } : null;
            await catsSvc.remove(categoryId);
            onChanged?.();
            onBack();
            showToast({
              message: "Area deleted",
              actionLabel: "Undo",
              onAction: async () => { if (gone) await catsSvc.create(gone.name, gone.color, gone.icon); onChanged?.(); },
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
            onDelete={existingLog ? () => {
              const kept = { ...existingLog.data };
              void metricWrite(() => metricsSvc.removeLog(existingLog.id), () => setMetricSheet(null));
              showToast({
                message: "Log deleted",
                actionLabel: "Undo",
                onAction: () => void metricWrite(() => metricsSvc.logMetric(kept.metricId, kept.date, { value: kept.value, yes: kept.yes })),
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
