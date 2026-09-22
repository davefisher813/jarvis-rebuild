import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import { ProjectsService } from "../projects/ProjectsService";
import { PeopleService } from "../people/PeopleService";
import { unfileArea, refileArea } from "./unfile";

// DELETING AN AREA USED TO STRAND EVERYTHING FILED UNDER IT (2026-09-20).
// Found in live data: one area deleted in June left 28 tasks and 6 events
// pointing at an id that no longer resolves, invisible to every area filter
// since. The area page even counts the cost ("Untags 12 Tasks") and showed
// it on the armed step while doing none of it.

function svcs() {
  const store = new Store(new InMemoryAdapter());
  return {
    tasks: new TasksService(store, "u"),
    schedule: new ScheduleService(store, "u"),
    notes: new NotesService(store, "u"),
    projects: new ProjectsService(store, "u"),
    people: new PeopleService(store, "u"),
  };
}

describe("unfileArea", () => {
  it("takes the area off its tasks, events, notes, projects and people, and leaves the others alone", async () => {
    const { tasks, schedule, notes, projects, people } = svcs();
    const doomed = "area-doomed", kept = "area-kept";
    const a = (await tasks.createTask("Order tables n chairs", { category: doomed }))!;
    const b = (await tasks.createTask("Set Stripe Demo", { category: kept }))!;
    const ev = (await schedule.createEvent("Walkthrough", { date: "2026-09-20", start: "10:00", category: doomed }))!;
    const other = (await schedule.createEvent("Standup", { date: "2026-09-20", start: "09:00", category: kept }))!;
    const note = (await notes.createNote("Kickoff notes", doomed))!;
    const proj = (await projects.create({ title: "Order chairs", status: "active", category: doomed }))!;
    const person = (await people.create({ name: "Vendor Contact", group: "contacts", categoryIds: [doomed] }))!;

    const prior = await unfileArea(doomed, tasks, schedule, notes, projects, people);

    const byId = new Map((await tasks.listTasks()).map((t) => [t.id, t.data]));
    expect(byId.get(a)!.category ?? "").toBe("");
    expect(byId.get(b)!.category).toBe(kept);
    const evs = new Map((await schedule.listEvents()).map((e) => [e.id, e.data]));
    expect(evs.get(ev)!.category ?? "").toBe("");
    expect(evs.get(other)!.category).toBe(kept);
    expect((await notes.note(note))!.category).toBe("");
    expect((await projects.get(proj))!.data.category).toBeUndefined();
    expect((await people.get(person))!.data.categoryIds ?? []).toEqual([]);

    // Undo puts them back exactly, because the area returns under its own id.
    await refileArea(prior, tasks, schedule, notes, projects, people);
    const back = new Map((await tasks.listTasks()).map((t) => [t.id, t.data]));
    expect(back.get(a)!.category).toBe(doomed);
    expect(new Map((await schedule.listEvents()).map((e) => [e.id, e.data])).get(ev)!.category).toBe(doomed);
    expect((await notes.note(note))!.category).toBe(doomed);
    expect((await projects.get(proj))!.data.category).toBe(doomed);
    expect((await people.get(person))!.data.categoryIds).toEqual([doomed]);
  });

  it("a task filed under two areas keeps the other one", async () => {
    const { tasks, schedule, notes, projects, people } = svcs();
    const id = (await tasks.createTask("Fall Clinic", { category: "gone", extraCategories: ["stays"] }))!;
    await unfileArea("gone", tasks, schedule, notes, projects, people);
    const t = (await tasks.listTasks()).find((x) => x.id === id)!;
    const all = [t.data.category ?? "", ...(t.data.extraCategories ?? [])].filter(Boolean);
    expect(all).toEqual(["stays"]);
  });

  it("does nothing when the area carries nothing", async () => {
    const { tasks, schedule, notes, projects, people } = svcs();
    await tasks.createTask("Unrelated", { category: "other" });
    const prior = await unfileArea("empty-area", tasks, schedule, notes, projects, people);
    expect(prior.tasks).toEqual([]);
    expect(prior.events).toEqual([]);
    expect(prior.notes).toEqual([]);
    expect(prior.projects).toEqual([]);
    expect(prior.people).toEqual([]);
  });
});
