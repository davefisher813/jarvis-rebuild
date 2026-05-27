import { useCallback } from "react";
import { useProfile, usePeople, useBrainDocs, useTasks, useSchedule, useCategories } from "../data/NotesProvider";
import { assembleContext, type AIContext } from "./context";

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

  return useCallback(async () => {
    const today = todayISO();
    const [p, ppl, tk, cs, ev, voice, values, philosophy] = await Promise.all([
      profile.get(),
      people.list(),
      tasks.listTasks(),
      cats.list(),
      schedule.eventsOn(today),
      docs.get("writing"),
      docs.get("values"),
      docs.get("philosophy"),
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
    });
  }, [profile, people, docs, tasks, schedule, cats]);
}
