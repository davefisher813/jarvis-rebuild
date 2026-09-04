import { useCallback } from "react";
import {
  useProfile, usePeople, useBrainDocs, useTasks, useSchedule, useCategories, useRoutine, useGoals, useProjects, useMoney,
  useOptionalProfile, useOptionalPeople, useOptionalBrainDocs, useOptionalTasks, useOptionalSchedule,
  useOptionalCategories, useOptionalRoutine, useOptionalGoals, useOptionalProjects, useOptionalMoney,
  useOptionalStrands, useOptionalDecisions, useOptionalSeal, useOptionalMetrics,
} from "../data/NotesProvider";
import type { StrandsService } from "../brain/strands/StrandsService";
import type { DecisionService } from "../decisions/DecisionService";
import type { SealService } from "../review/seal";
import type { MetricsService } from "../gym/MetricsService";
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
import { loadEnvelopes, setAsideTotal, leftToSpend } from "../money/budget";

export function todayISO(d = new Date()): string {
  return d.toISOString().slice(0, 10);
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
}

// Session 5: the ONE assembler behind every AI feature. Routine, goals,
// projects, money signals, learned patterns, and the app-written habits doc
// all ride along, so no feature reasons from a thinner picture. Both hooks
// below funnel through this single function, so there is still exactly one
// place that decides what the AI knows.
async function gatherFrom(s: ContextServices): Promise<AIContext> {
  const today = todayISO();
  const [p, ppl, tk, cs, ev, voice, values, philosophy, rt, gl, pj, mn, habits] = await Promise.all([
    s.profile.get(),
    s.people.list(),
    s.tasks.listTasks(),
    s.cats.list(),
    s.schedule.eventsOn(today),
    s.docs.get("writing"),
    s.docs.get("values"),
    s.docs.get("philosophy"),
    s.routine.get(),
    s.goals.list(),
    s.projects.list(),
    s.money.list(),
    s.docs.get("habits"),
  ]);
  // What JARVIS knows (Brain Layer 2 bridge): active strands, one line each.
  // Best-effort; a strand read failure must never cost the user their prompt.
  //
  // STRENGTHEN (handoff 5.8, decision m1): read in recall order, not
  // creation order. What JARVIS leans on first is what has most recently
  // been proved right. See brain/recall.ts; nothing is dropped here, only
  // ordered, so a quiet fact is still a fact the AI can see.
  let strandLines: string[] = [];
  try {
    strandLines = s.strands ? rankForRecall(await s.strands.active(), today).map((x) => x.data.text) : [];
  } catch { /* thinner context, never a broken one */ }
  // READ-BACK (handoff item 5, second half): settled decisions join the
  // context so JARVIS stops re-asking what was already decided, and can say
  // what changed since. Superseded decisions are excluded by list(); the
  // reason rides along because the reason is the whole point of the record.
  let decisionLines: string[] = [];
  try {
    decisionLines = s.decisions
      ? (await s.decisions.list())
        .slice(0, 12)
        .map((d) => (d.data.why ? `${d.data.decision} (because ${d.data.why})` : d.data.decision))
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
  // The full money picture (2026-08-10): bills with amounts and due dates,
  // and the same cash-flow derivation the Money tab shows (payday, bills
  // before it, envelopes, left to spend). Same helpers, so the AI can never
  // quote a different number than the screen. Payday math is Personal
  // template only, matching MoneyFlow's gate.
  const openBills = activeBills(tk, today).filter((b) => !b.data.done);
  const payday = (p?.template ?? "personal") === "personal" ? p?.payday : undefined;
  let cashFlow: { paycheck: number; nextPayday: string; billsOut: number; setAside: number; left: number; short: boolean } | null = null;
  if (payday) {
    const next = paydayNext(payday, today);
    const billsOut = openBills
      .filter((b) => !!b.data.due && b.data.due <= next)
      .reduce((sum, b) => sum + (b.data.bill?.amount ?? 0), 0);
    const setAside = setAsideTotal(loadEnvelopes());
    const l = leftToSpend(payday.amount, billsOut, setAside);
    cashFlow = { paycheck: payday.amount, nextPayday: next, billsOut, setAside, left: l.amount, short: l.short };
  }
  // Read once for every goal below: readSamples parses device storage, and
  // doing it per goal would parse it five times to answer one question.
  const goalSamples = readSamples();
  const goalNow = Date.now();
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
    tasks: tk.map((t) => ({ text: t.data.text, done: t.data.done, category: t.data.category })),
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
    money: mn.map((a) => ({ name: a.data.name, balance: a.data.balance })),
    bills: openBills.map((b) => ({
      name: b.data.text,
      amount: b.data.bill?.amount ?? 0,
      due: b.data.due,
      ...(b.data.bill?.autopay ? { autopay: true } : {}),
    })),
    cashFlow,
    strands: strandLines,
    decisions: decisionLines,
    months: monthLines,
    pulse: pulseLinesOut,
  });
}

// Returns a gather() that assembles the user's live context for the AI.
export function useAIContext(): () => Promise<AIContext> {
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

  return useCallback(
    () => gatherFrom({ profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics }),
    [profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics],
  );
}

// Same context, for a feature that must still render when NotesProvider is not
// above it (Brain Personalization Phase 3). Resolves to null instead of
// throwing, so personalization stays what it should be: an enhancement that
// degrades to the plain prompt, never a new hard dependency. MessagesFlow uses
// this for the same reason it uses useOptionalTasks.
export function useOptionalAIContext(): () => Promise<AIContext | null> {
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

  return useCallback(async () => {
    if (!profile || !people || !docs || !tasks || !schedule || !cats || !routine || !goals || !projects || !money) return null;
    return gatherFrom({ profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics });
  }, [profile, people, docs, tasks, schedule, cats, routine, goals, projects, money, strands, decisions, seal, metrics]);
}
