import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./notes/NotesService";
import { TasksService } from "./tasks/TasksService";
import { ScheduleService } from "./schedule/ScheduleService";
import { CategoriesService } from "./categories/CategoriesService";
import { seedDemoData } from "./data/seed";
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
    expect(sum.events).toBe(6);
    expect(sum.overdue).toBe(2);
    expect(sum.due).toBe(2);
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
