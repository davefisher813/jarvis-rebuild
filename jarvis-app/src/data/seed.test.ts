import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { CategoriesService } from "../categories/CategoriesService";
import { seedDemoData } from "./seed";

// A DOT IS THE STYLESHEET'S TO DRAW, NEVER A CHARACTER IN A TITLE (Dave 2026-10-05, the visual catalog gate, rule 3).
// The demo seeded "Board Call · Rob Calder" and "Sponsor Pitch · Summit Gear". On a row that wraps, a title cannot
// break where its dot is, so the dot landed at the head of the second line ("· Summit Gear") and read as a stray mark.
// A title is words; the facts beside it are spans. This holds every title the demo writes.
describe("demo seed: no typed separator inside a title", () => {
  it("no event or task title carries a middle dot, a bullet or a bar", async () => {
    const store = new Store(new InMemoryAdapter());
    const o = "u1";
    const tasks = new TasksService(store, o);
    const schedule = new ScheduleService(store, o);
    const categories = new CategoriesService(store, o);
    await categories.seedDefaults("personal");
    await seedDemoData(tasks, schedule, await categories.list());
    const titles = [
      ...(await schedule.listEvents()).map((e) => e.data.title),
      ...(await tasks.listTasks()).map((t) => t.data.text),
    ];
    expect(titles.length).toBeGreaterThan(10);
    expect(titles.filter((t) => /[·•|]/.test(t))).toEqual([]);
  });

  it("the two tomorrow events that had one are worded with a plain connecting word", async () => {
    const store = new Store(new InMemoryAdapter());
    const o = "u1";
    const schedule = new ScheduleService(store, o);
    const categories = new CategoriesService(store, o);
    await categories.seedDefaults("personal");
    await seedDemoData(new TasksService(store, o), schedule, await categories.list());
    const titles = (await schedule.listEvents()).map((e) => e.data.title);
    expect(titles).toContain("Board Call with Rob Calder");
    expect(titles).toContain("Sponsor Pitch for Summit Gear");
  });
});
