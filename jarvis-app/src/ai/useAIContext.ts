import { useCallback } from "react";
import {
  useProfile, usePeople, useBrainDocs, useTasks, useSchedule, useCategories, useRoutine, useGoals, useProjects, useMoney,
  useOptionalProfile, useOptionalPeople, useOptionalBrainDocs, useOptionalTasks, useOptionalSchedule,
  useOptionalCategories, useOptionalRoutine, useOptionalGoals, useOptionalProjects, useOptionalMoney,
  useOptionalStrands, useOptionalDecisions, useOptionalSeal, useOptionalMetrics, useOptionalGym, useOptionalNotes,
} from "../data/NotesProvider";
import type { StrandsService } from "../brain/strands/StrandsService";
import type { DecisionService } from "../decisions/DecisionService";
import type { NotesService } from "../notes/NotesService";
import type { SealService } from "../review/seal";
import type { MetricsService } from "../gym/MetricsService";
import type { GymService } from "../gym/GymService";
import { trainingLines } from "../gym/trainingContext";
import { readGymSettings, rackFrom } from "../gym/settings";
import { protectedRangesFor, DEFAULT_ROUTINE } from "../routine/types";
import { occursOn } from "../schedule/calendar";
import { sealLines } from "../review/seal";
import { rankForRecall } from "../brain/recall";
import { pulseLines } from "../brain/pulse";
import { assembleContext, type AIContext } from "./context";
import { routineToText } from "../routine/types";
import { readSamples } from "../shared/timeSense";
import { reachOf, liveGoals } from "../bigger/reach";
import { measureState, healthOf, goalStatusForAI } from "../bigger/measure";
import { openWorkOf } from "../today/goalPulse";
import { activeBills, paydayNext } from "../money/bills";
import { setAsideTotal, leftToSpend } from "../money/budget";
import { signedBalance } from "../money/types";
import { relatedLines, relatedStrands, type Anchor } from "../brain/related";
import { loadLinks } from "../messages/threadLink";

// B2-4 (2026-09-04): this used to serialise with toISOString(), which reads
// UTC. Four other modules (Chat, Today's suggestions, Quick Capture, the
// Brain's strands page) import "today" from here alongside AI context, and
// Notifications imported it as its ONLY source of today, with nothing else
// in that screen using a local one to disagree with. The result was an 8
// PM Eastern rollover: today's remaining events vanished, tomorrow's showed
// as today, and due-today tasks re-badged as Overdue, hours before midnight.
// Tasks (grouping.ts) and Schedule (calendar.ts) both already do this
// correctly; this brings the AI layer's notion of "today" in line with theirs.
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Derived from the hooks rather than imported by path, so moving a service
// file can never silently widen these to any.
interface ContextServices {
  profile: ReturnType<typeof useProfile>;
  people: ReturnType<typeof usePeople>;
  docs: ReturnType<typeof useBrainDocs>;
  tasks: ReturnType<typeof useTasks>;
  schedule: ReturnType<typeof useSchedule>;
  cats: ReturnType<typeof useCategories>;
  routine: ReturnType<typeof useRoutine>;
  goals: ReturnType<typeof useGoals>;
  projects: ReturnType<typeof useProjects>;
  money: ReturnType<typeof useMoney>;
  // Optional on purpose: strands are an enhancement (Brain Layer 2 bridge);
  // a context assembled without them is thinner, never broken.
  strands?: StrandsService | null;
  // Same seam for settled decisions (handoff item 5, read-back).
  decisions?: DecisionService | null;
  // And for the monthly seals (handoff item 8): Insights was fully automatic
  // and display-only, computing an honest record nothing ever read.
  seal?: SealService | null;
  // And for the daily pulse (handoff item 11): metric logs have been durable
  // since D10-B and were read only by the gym's own insight cards, so a month
  // of logged sleep taught the planner nothing. Optional, same seam as the
  // three above: no metrics store means a thinner context, never a broken one.
  metrics?: MetricsService | null;
  // UP-ATH-19 (2026-09-06): the gym. Optional on the same seam as the four
  // above, for the same reason: no gym store means a thinner context, never
  // a broken one, and no gym history means no training lines at all.
  gym?: GymService | null;
  // UP-MIND-23 class (2026-09-07): notes, the fourth thing this function's
  // own comment below already promised ("plus decisions and notes it reads
  // for exactly this") but never wired. Same seam: no notes store means no
  // "Note: <title>" line in a scoped prompt, never a broken one.
  notes?: NotesService | null;
}

// Session 5: the ONE assembler behind every AI feature. Routine, goals,
// projects, money signals, learned patterns, and the app-written habits doc
// all ride along, so no feature reasons from a thinner picture. Both hooks
// below funnel through this single function, so there is still exactly one
// place that decides what the AI knows.
// UP-MIND-23 (2026-09-05): the situation the caller is in, when there is
// one. With no anchor every caller gets exactly the context it always got.
export type ContextAbout = Anchor;

async function gatherFrom(s: ContextServices, about?: ContextAbout): Promise<AIContext> {
  const today = todayISO();
  // BRAIN-F-12 class (2026-09-05): every OPTIONAL read below this point is
  // wrapped ("thinner context, never a broken one"). These thirteen were not,
  // although every one of them is exactly the same kind of failure -- a
  // dropped connection, a server hiccup -- and each has an honest empty
  // shape to fall back to. One rejection here used to reject the whole
  // function, which means Plan My Day (both copies: this file backs
  // TodayFlow's and ScheduleFlow's onAIPlan) went dead with no error, no
  // toast, nothing: the tap just did nothing. Individual .catch() per read
  // so a single flaky store costs that one section of the prompt, not the
  // prompt.
  const [p, ppl, tk, cs, ev, voice, values, philosophy, rt, gl, pj, mn, habits] = await Promise.all([
    s.profile.get().catch(() => null),
    s.people.list().catch(() => []),
    s.tasks.listTasks().catch(() => []),
    s.cats.list().catch(() => []),
    s.schedule.eventsOn(today).catch(() => []),
    s.docs.get("writing").catch(() => ""),
    s.docs.get("values").catch(() => ""),
    s.docs.get("philosophy").catch(() => ""),
    s.routine.get().catch(() => ({ ...DEFAULT_ROUTINE })),
    s.goals.list().catch(() => []),
    s.projects.list().catch(() => []),
    s.money.list().catch(() => []),
    s.docs.get("habits").catch(() => ""),
  ]);
  // What JARVIS knows (Brain Layer 2 bridge): active strands, one line each.
  // Best-effort; a strand read failure must never cost the user their prompt.
  //
  // STRENGTHEN (handoff 5.8, decision m1): read in recall order, not
  // creation order. What JARVIS leans on first is what has most recently
  // been proved right. See brain/recall.ts; nothing is dropped here, only
  // ordered, so a quiet fact is still a fact the AI can see.
  let strandLines: string[] = [];
  // S4-Q25 (2026-09-04): the Writing-bucket subset, for the drafting prompt
  // only (voiceToText). Same read, same recall order, just filtered by
  // category rather than a second call to the store.
  let writingFactLines: string[] = [];
  try {
    const ranked = s.strands ? rankForRecall(await s.strands.active(), today) : [];
    strandLines = ranked.map((x) => x.data.text);
    writingFactLines = ranked.filter((x) => x.data.category === "writing").map((x) => x.data.text);
  } catch { /* thinner context, never a broken one */ }
  // READ-BACK (handoff item 5, second half): settled decisions join the
  // context so JARVIS stops re-asking what was already decided, and can say
  // what changed since. Superseded decisions are excluded by list(); the
  // reason rides along because the reason is the whole point of the record.
  //
  // B5 (2026-09-04): ruledOut is the record's whole stop-relitigating block
  // -- captured, edited, and shown as its own "Ruled Out" section on the
  // record's page -- and it never rode along here, so JARVIS could propose
  // back the exact option the record closed. It joins the why clause rather
  // than getting its own sentence, so the shape stays one line per decision.
  let decisionLines: string[] = [];
  try {
    decisionLines = s.decisions
      ? (await s.decisions.list())
        .slice(0, 12)
        .map((d) => {
          const parts: string[] = [];
          if (d.data.why) parts.push(`because ${d.data.why}`);
          if (d.data.ruledOut?.length) parts.push(`ruled out: ${d.data.ruledOut.join(", ")}`);
          return parts.length ? `${d.data.decision} (${parts.join("; ")})` : d.data.decision;
        })
      : [];
  } catch { /* same rule: thinner, never broken */ }
  // INSIGHTS GETS AN OUTPUT (handoff item 8, decision s2): a compressed line
  // per sealed month, so JARVIS reasons about the months the user actually
  // had. Facts and counts only; a life is never scored. See seal.ts.
  let monthLines: string[] = [];
  try {
    monthLines = s.seal ? sealLines(await s.seal.list()) : [];
  } catch { /* same rule again */ }
  // THE PULSE (handoff item 11, Dave's option A). One line per metric with
  // enough history, in its own units. See brain/pulse.ts for the three
  // refusals it keeps: no score, no verdict, and silence below three days.
  let pulseLinesOut: string[] = [];
  try {
    if (s.metrics) {
      const [defs, logs] = await Promise.all([s.metrics.listDefs(), s.metrics.listLogs()]);
      pulseLinesOut = pulseLines(defs, logs, today);
    }
  } catch { /* same rule again */ }
  // UP-ATH-19 (2026-09-06): the gym's own facts, beside the pulse. Until now
  // nothing in ai/, schedule/planDayAI or dayloop/ mentioned training at all,
  // so the assistant planned a Tuesday evening the athlete had already
  // spent. Every number below comes from a derivation the gym pages already
  // render; see gym/trainingContext.ts for the refusals it keeps.
  let trainingLinesOut: string[] = [];
  try {
    if (s.gym) {
      const [programs, workouts] = await Promise.all([s.gym.listPrograms(), s.gym.listWorkouts()]);
      const program = programs.find((p) => !p.data.archived) ?? null;
      const dow = new Date(today + "T12:00:00").getDay();
      // THE SEASON LINK, same read GymFlow's own does: gated on the athlete
      // having said which category means a game, so this never guesses one.
      let nextGame: string | null = null;
      let hasGymEventToday = false;
      const catId = program?.data.inSeason ? program.data.gameCategoryId : undefined;
      const events = await s.schedule.listEvents();
      hasGymEventToday = events.some((e) => e.data.gym && occursOn(e.data, today));
      if (catId) {
        for (let i = 0; i <= 7; i++) {
          const iso = isoPlus(today, i);
          if (events.some((e) => e.data.category === catId && occursOn(e.data, iso))) { nextGame = iso; break; }
        }
      }
      const gymBlock = rt ? protectedRangesFor(rt, dow).find((b) => b.kind === "gym") : undefined;
      trainingLinesOut = trainingLines({
        program,
        workouts,
        today,
        dow,
        rack: rackFrom(readGymSettings()),
        nextGame,
        gymWindow: gymBlock ? { startMin: gymBlock.s, endMin: gymBlock.e } : null,
        hasGymEventToday,
      });
    }
  } catch { /* same rule again */ }
  // The full money picture (2026-08-10): bills with amounts and due dates,
  // and the same cash-flow derivation the Money tab shows (payday, bills
  // before it, envelopes, left to spend). Same helpers, so the AI can never
  // quote a different number than the screen. S5-Q33 (2026-09-04): the gate
  // is now everyone but Business, matching MoneyFlow's own payHalfOn -- a
  // stale "Personal only" copy of this check used to leave Student's Money
  // tab showing payday math the AI would then deny existed.
  const openBills = activeBills(tk, today).filter((b) => !b.data.done);
  const payday = (p?.template ?? "personal") !== "business" ? p?.payday : undefined;
  let cashFlow: { paycheck: number; nextPayday: string; billsOut: number; setAside: number; left: number; short: boolean } | null = null;
  if (payday) {
    const next = paydayNext(payday, today);
    const billsOut = openBills
      .filter((b) => !!b.data.due && b.data.due <= next)
      .reduce((sum, b) => sum + (b.data.bill?.amount ?? 0), 0);
    // HMN-F-12 (2026-09-05): read off the profile this function already has,
    // so Chat on a second device knows about the same envelopes the Money
    // tab there is subtracting. It used to read this phone's localStorage.
    const setAside = setAsideTotal(p?.envelopes ?? []);
    const l = leftToSpend(payday.amount, billsOut, setAside);
    cashFlow = { paycheck: payday.amount, nextPayday: next, billsOut, setAside, left: l.amount, short: l.short };
  }
  // Read once for every goal below: readSamples parses device storage, and
  // doing it per goal would parse it five times to answer one question.
  const goalSamples = readSamples();
  const goalNow = Date.now();
  // UP-MIND-23: ONE HOP from the thing in hand. Built from the stores this
  // function already read, plus decisions and notes it reads for exactly
  // this; a failed read means a thinner block, never a broken prompt. Empty
  // without an anchor, which is what keeps every existing caller unchanged.
  let related: string[] = [];
  let scopedStrands: string[] | null = null;
  if (about && (about.personId || about.personName || about.projectId || about.threadId)) {
    try {
      const [decisionRecords, noteItems] = await Promise.all([
        s.decisions ? s.decisions.list().catch(() => []) : Promise.resolve([]),
        s.notes ? s.notes.list().catch(() => []) : Promise.resolve([] as { title: string; connections?: { type: string; id: string }[] }[]),
      ]);
      const links = loadLinks();
      related = relatedLines(about, {
        tasks: tk.map((t) => ({
          id: t.id, text: t.data.text, done: t.data.done, due: t.data.due ?? null,
          ...(t.data.personId ? { personId: t.data.personId } : {}),
          ...(t.data.projectId ? { projectId: t.data.projectId } : {}),
          ...(t.data.fromThread ? { fromThread: t.data.fromThread } : {}),
        })),
        events: ev.map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, location: e.data.location })),
        decisions: decisionRecords.map((d) => ({
          decision: d.data.decision,
          ...(d.data.why ? { why: d.data.why } : {}),
          ...(d.data.linkedType ? { linkedType: d.data.linkedType } : {}),
          ...(d.data.linkedId ? { linkedId: d.data.linkedId } : {}),
        })),
        notes: noteItems,
        strands: [],
        threadProject: (threadId) => (links[threadId]?.type === "project" ? links[threadId]!.id : undefined),
        projects: pj.map((p) => ({ id: p.id, title: p.data.title })),
        today,
      });
      // The scoped strand set REPLACES the flat one: an anchored prompt that
      // also carried everything JARVIS knows is the unscoped prompt.
      scopedStrands = relatedStrands(about, strandLines.map((text) => ({ text })));
    } catch { /* thinner context, never a broken one */ }
  }
  return assembleContext({
    name: p?.name,
    template: p?.template,
    people: ppl.map((x) => x.data.name),
    peopleDetail: ppl.map((x) => ({
      name: x.data.name,
      label: x.data.relationship,
      register: x.data.register,
      flagged: x.data.flagged,
    })),
    categories: cs.map((c) => ({ name: c.data.name })),
    // TRACE-03 (2026-09-07): the checklist rollup, counted here so the item
    // text never enters the assembler at all. Omitted on a task with no
    // checklist rather than sent as a zero.
    tasks: tk.map((t) => {
      const steps = t.data.steps ?? [];
      return {
        text: t.data.text,
        done: t.data.done,
        category: t.data.category,
        ...(steps.length > 0 ? { steps: { done: steps.filter((s) => s.done).length, total: steps.length } } : {}),
      };
    }),
    events: ev.map((e) => ({ title: e.data.title, start: e.data.start })),
    voice,
    values,
    philosophy,
    routine: { workStartMin: rt.workStartMin, workEndMin: rt.workEndMin },
    routineDetail: routineToText(rt),
    // PICK 28 (2026-08-24): THE BRAIN KNOWS THE CURRENT GOALS, not the ones
    // the record was created with. `g.data.state` is the stored status that
    // nothing anywhere updates, so every AI feature in the app has been
    // reasoning about statuses typed once, months ago. It gets the derived
    // health and the finish line now, from the same functions the goal page
    // renders. Dropped goals are left out entirely: they are not goals.
    goals: liveGoals(gl).map((g) => {
      const mctx = {
        reach: reachOf(tk, pj, g),
        tasks: tk, projects: pj.filter((x) => x.data.goalId === g.id),
        samples: goalSamples, today, now: goalNow,
      };
      const ms = measureState(g.data.measure, mctx);
      const open = openWorkOf(mctx.reach);
      return { name: g.data.title, status: goalStatusForAI(healthOf(g, ms, g.data.measure, mctx, open), ms) };
    }),
    projects: pj.map((x) => x.data.title),
    habits,
    completionSamples: readSamples().map((s2) => ({ h: s2.h, t: s2.t })),
    // HMN-F-13 (2026-09-05): what the account contributes, so a credit card
    // reaches the model as the debt it is and Chat cannot quote a total the
    // Money tab disagrees with.
    money: mn.map((a) => ({ name: a.data.name, balance: signedBalance(a.data) })),
    bills: openBills.map((b) => ({
      name: b.data.text,
      amount: b.data.bill?.amount ?? 0,
      due: b.data.due,
      ...(b.data.bill?.autopay ? { autopay: true } : {}),
    })),
    cashFlow,
    strands: scopedStrands ?? strandLines,
    related,
    writingFacts: writingFactLines,
    decisions: decisionLines,
    months: monthLines,
    pulse: pulseLinesOut,
    training: trainingLinesOut,
  });
}

// UP-ATH-19: local days, stepped with setDate, never by adding 86,400,000 ms
// (the timezone law: a DST boundary is not 24 hours long).
function isoPlus(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Returns a gather() that assembles the user's live context for the AI.
export function useAIContext(): (about?: ContextAbout) => Promise<AIContext> {
  const profile = useProfile();
  const people = usePeople();
  const docs = useBrainDocs();
  const tasks = useTasks();
  const schedule = useSchedule();
  const cats = useCategories();
  const routine = useRoutine();
  const goals = useGoals();
  const projects = useProjects();
  const money = useMoney();
  const strands = useOptionalStrands();
  const decisions = useOptionalDecisions();
  const seal = useOptionalSeal();
  const metrics = useOptionalMetrics();
  const gym = useOptionalGym();
  const notes = useOptionalNotes();

  return useCallback(
    (about?: ContextAbout) => gatherFrom({ profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics, gym, notes }, about),
    [profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics, gym, notes],
  );
}

// Same context, for a feature that must still render when NotesProvider is not
// above it (Brain Personalization Phase 3). Resolves to null instead of
// throwing, so personalization stays what it should be: an enhancement that
// degrades to the plain prompt, never a new hard dependency. MessagesFlow uses
// this for the same reason it uses useOptionalTasks.
export function useOptionalAIContext(): (about?: ContextAbout) => Promise<AIContext | null> {
  const profile = useOptionalProfile();
  const people = useOptionalPeople();
  const docs = useOptionalBrainDocs();
  const tasks = useOptionalTasks();
  const schedule = useOptionalSchedule();
  const cats = useOptionalCategories();
  const routine = useOptionalRoutine();
  const goals = useOptionalGoals();
  const projects = useOptionalProjects();
  const money = useOptionalMoney();
  const strands = useOptionalStrands();
  const decisions = useOptionalDecisions();
  const seal = useOptionalSeal();
  const metrics = useOptionalMetrics();
  const gym = useOptionalGym();
  const notes = useOptionalNotes();

  return useCallback(async (about?: ContextAbout) => {
    if (!profile || !people || !docs || !tasks || !schedule || !cats || !routine || !goals || !projects || !money) return null;
    return gatherFrom({ profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics, gym, notes }, about);
  }, [profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics, gym, notes]);
}
