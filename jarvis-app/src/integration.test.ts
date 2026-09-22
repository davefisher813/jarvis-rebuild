import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./notes/NotesService";
import { TasksService } from "./tasks/TasksService";
import { ScheduleService } from "./schedule/ScheduleService";
import { CategoriesService } from "./categories/CategoriesService";
import { seedDemoData } from "./data/seed";
import { GymService } from "./gym/GymService";
import { AreaService } from "./life/AreaService";
import { GoalService } from "./life/GoalService";
import { ProjectsService } from "./projects/ProjectsService";
import { MoneyService } from "./money/MoneyService";
import { PeopleService } from "./people/PeopleService";
import type { SealService } from "./review/seal";
import { todaysTasks, daySummary } from "./today/todayData";
import { todayISO } from "./schedule/calendar";

// One store, three services, like the real shared provider.
function svc() {
  const store = new Store(new InMemoryAdapter());
  const o = "u1";
  return {
    notes: new NotesService(store, o),
    tasks: new TasksService(store, o),
    schedule: new ScheduleService(store, o),
    categories: new CategoriesService(store, o),
    store, o,
  };
}

/** The whole Extras bag, for the seed paths that only run with one. */
function extrasFor(store: Store, o: string) {
  return {
    areas: new AreaService(store, o),
    goals: new GoalService(store, o),
    projects: new ProjectsService(store, o),
    money: new MoneyService(store, o),
    people: new PeopleService(store, o),
    gym: new GymService(store, o),
  };
}

describe("integration: notes checklist feeds Tasks (shared store)", () => {
  it("checklist items become tasks visible in Tasks, linked and categorized", async () => {
    const { notes, tasks } = svc();
    const id = await notes.createNote("Marathon Plan", "health");
    expect(id).toBeTruthy();
    await notes.addChecklist(id!, ["Easy 6 Miles", "Foam Roll"]);
    const made = await notes.tasksFromChecklist(id!);
    expect(made.length).toBe(2);
    const fromNote = (await tasks.listTasks()).filter((t) => t.data.fromNote === id);
    expect(fromNote.length).toBe(2);
    expect(fromNote.every((t) => t.data.category === "health")).toBe(true);
  });

  it("deleting the note leaves its tasks behind (one-way link, no cascade)", async () => {
    const { notes, tasks } = svc();
    const id = await notes.createNote("Trip", "family");
    await notes.addChecklist(id!, ["Book Hotel"]);
    await notes.tasksFromChecklist(id!);
    await notes.deleteNote(id!);
    expect((await tasks.listTasks()).length).toBe(1);
  });
});

describe("integration: demo seed feeds Today", () => {
  it("seeds events and tasks that Today aggregates correctly", async () => {
    const { tasks, schedule, categories } = svc();
    await categories.seedDefaults("personal");
    const cats = await categories.list();
    await seedDemoData(tasks, schedule, cats);
    const today = todayISO();
    const ev = await schedule.eventsOn(today);
    const tk = await tasks.listTasks();
    const sum = daySummary(ev, tk, today);
    // Six today: standup, Nadia, Deep Work, the drive, the clinic, the gym.
    // Deep Work and the drive were added 2026-08-21 so blending has something
    // to demonstrate; the blend offer is only as real as a block to put it in.
    expect(sum.events).toBe(6);
    expect(sum.overdue).toBe(1);
    expect(sum.due).toBe(3);
    expect(todaysTasks(tk, today).length).toBe(4);
  });

  it("seeding is idempotent (no duplicates on a second run)", async () => {
    const { tasks, schedule, categories } = svc();
    await categories.seedDefaults("personal");
    const cats = await categories.list();
    await seedDemoData(tasks, schedule, cats);
    await seedDemoData(tasks, schedule, cats);
    expect((await schedule.listEvents()).length).toBe(12);
    expect((await tasks.listTasks()).length).toBe(9);
  });
});

describe("integration: the demo seed can actually be trained", () => {
  // WHY THIS IS A TEST AND NOT A SCREENSHOT (2026-09-21). The seed used to
  // write fourteen finished sessions with `exercises: []` against a program
  // id no program had. Health therefore read "Set Up a Program / 0 Days", and
  // START WAS NOT ON THE SCREEN: the live session, the set strip, the rest
  // clock and the finish receipt were unreachable in every demo build and in
  // every visual-audit run ever made. That is not a gym bug, it is a seed
  // bug, and a seed bug is exactly the kind that goes unnoticed for months
  // because nothing fails -- the screens just quietly show nothing.
  it("seeds a program with days and lifts, so a session can be started", async () => {
    const { tasks, schedule, categories, store, o } = svc();
    await categories.seedDefaults("personal");
    const extras = extrasFor(store, o);
    await seedDemoData(tasks, schedule, await categories.list(), extras);

    const programs = await extras.gym.listPrograms();
    expect(programs.length).toBe(1);
    const days = programs[0]!.data.weeks[0]!.days;
    expect(days.map((d) => d.name)).toEqual(["Push Day", "Pull Day"]);
    for (const d of days) {
      expect(d.exercises.length).toBe(4);
      expect(d.pinDays?.length).toBe(2);
      // Every lift needs a target strip, or the session opens on empty chips.
      for (const ex of d.exercises) expect(ex.sets.length).toBeGreaterThan(0);
    }
  });

  it("seeds finished sessions with real sets, so prefill has a prior session", async () => {
    const { tasks, schedule, categories, store, o } = svc();
    await categories.seedDefaults("personal");
    const extras = extrasFor(store, o);
    const seal = { list: async () => [], create: async () => "s1" } as unknown as SealService;
    await seedDemoData(tasks, schedule, await categories.list(), { ...extras, seal });

    const workouts = await extras.gym.listWorkouts();
    expect(workouts.length).toBe(14);
    const pid = (await extras.gym.listPrograms())[0]!.id;
    for (const w of workouts) {
      // Pointed at the real program, not the old "demo" string.
      expect(w.data.programId).toBe(pid);
      expect(w.data.exercises.length).toBe(4);
      for (const ex of w.data.exercises) expect(ex.sets.length).toBeGreaterThan(0);
    }
  });
});
