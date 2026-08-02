import { useCallback } from "react";
import { useProfile, usePeople, useBrainDocs, useTasks, useSchedule, useCategories, useRoutine, useGoals, useProjects, useMoney } from "../data/NotesProvider";
import { assembleContext, type AIContext } from "./context";
import { readSamples } from "../shared/timeSense";

export function todayISO(d = new Date()): string {
  return d.toISOString().slice(0, 10);
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

  return useCallback(async () => {
    const today = todayISO();
    // Session 5: the ONE assembler behind every AI feature. Routine, goals,
    // projects, money signals, learned patterns, and the app-written habits
    // doc all ride along, so no feature reasons from a thinner picture.
    const [p, ppl, tk, cs, ev, voice, values, philosophy, rt, gl, pj, mn, habits] = await Promise.all([
      profile.get(),
      people.list(),
      tasks.listTasks(),
      cats.list(),
      schedule.eventsOn(today),
      docs.get("writing"),
      docs.get("values"),
      docs.get("philosophy"),
      routine.get(),
      goals.list(),
      projects.list(),
      money.list(),
      docs.get("habits"),
    ]);
    return assembleContext({
      name: p?.name,
      template: p?.template,
      people: ppl.map((x) => x.data.name),
      categories: cs.map((c) => ({ name: c.data.name })),
      tasks: tk.map((t) => ({ text: t.data.text, done: t.data.done, category: t.data.category })),
      events: ev.map((e) => ({ title: e.data.title, start: e.data.start })),
      voice,
      values,
      philosophy,
      routine: { workStartMin: rt.workStartMin, workEndMin: rt.workEndMin },
      goals: gl.map((g) => ({ name: g.data.title, status: g.data.state })),
      projects: pj.map((x) => x.data.title),
      habits,
      completionSamples: readSamples().map((s) => ({ h: s.h, t: s.t })),
      money: mn.map((a) => ({ name: a.data.name, balance: a.data.balance })),
    });
  }, [profile, people, docs, tasks, schedule, cats, routine, goals, projects, money]);
}
