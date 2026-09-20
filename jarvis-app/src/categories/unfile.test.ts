import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { unfileArea, refileArea } from "./unfile";

// DELETING AN AREA USED TO STRAND EVERYTHING FILED UNDER IT (2026-09-20).
// Found in live data: one area deleted in June left 28 tasks and 6 events
// pointing at an id that no longer resolves, invisible to every area filter
// since. The area page even counts the cost ("Untags 12 Tasks") and showed
// it on the armed step while doing none of it.

function svcs() {
  const store = new Store(new InMemoryAdapter());
  return { tasks: new TasksService(store, "u"), schedule: new ScheduleService(store, "u") };
}

describe("unfileArea", () => {
  it("takes the area off its tasks and events, and leaves the others alone", async () => {
    const { tasks, schedule } = svcs();
    const doomed = "area-doomed", kept = "area-kept";
    const a = (await tasks.createTask("Order tables n chairs", { category: doomed }))!;
    const b = (await tasks.createTask("Set Stripe Demo", { category: kept }))!;
    const ev = (await schedule.createEvent("Walkthrough", { date: "2026-09-20", start: "10:00", category: doomed }))!;
    const other = (await schedule.createEvent("Standup", { date: "2026-09-20", start: "09:00", category: kept }))!;

    const prior = await unfileArea(doomed, tasks, schedule);

    const byId = new Map((await tasks.listTasks()).map((t) => [t.id, t.data]));
    expect(byId.get(a)!.category ?? "").toBe("");
    expect(byId.get(b)!.category).toBe(kept);
    const evs = new Map((await schedule.listEvents()).map((e) => [e.id, e.data]));
    expect(evs.get(ev)!.category ?? "").toBe("");
    expect(evs.get(other)!.category).toBe(kept);

    // Undo puts them back exactly, because the area returns under its own id.
    await refileArea(prior, tasks, schedule);
    const back = new Map((await tasks.listTasks()).map((t) => [t.id, t.data]));
    expect(back.get(a)!.category).toBe(doomed);
    expect(new Map((await schedule.listEvents()).map((e) => [e.id, e.data])).get(ev)!.category).toBe(doomed);
  });

  it("a task filed under two areas keeps the other one", async () => {
    const { tasks, schedule } = svcs();
    const id = (await tasks.createTask("Fall Clinic", { category: "gone", extraCategories: ["stays"] }))!;
    await unfileArea("gone", tasks, schedule);
    const t = (await tasks.listTasks()).find((x) => x.id === id)!;
    const all = [t.data.category ?? "", ...(t.data.extraCategories ?? [])].filter(Boolean);
    expect(all).toEqual(["stays"]);
  });

  it("does nothing when the area carries nothing", async () => {
    const { tasks, schedule } = svcs();
    await tasks.createTask("Unrelated", { category: "other" });
    const prior = await unfileArea("empty-area", tasks, schedule);
    expect(prior.tasks).toEqual([]);
    expect(prior.events).toEqual([]);
  });
});
