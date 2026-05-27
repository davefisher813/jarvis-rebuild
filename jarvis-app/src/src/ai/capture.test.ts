import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { parseCapture, localParse, applyCapture } from "./capture";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import type { Category } from "../categories/types";

const CATS: Category[] = [{ id: "c1", data: { name: "Work", color: "blue", order: 0 } }];

describe("parseCapture", () => {
  it("parses plain JSON", () => {
    expect(parseCapture('{"kind":"event","title":"Standup"}')?.kind).toBe("event");
  });
  it("parses fenced JSON", () => {
    expect(parseCapture('```json\n{"kind":"task","title":"Email"}\n```')?.title).toBe("Email");
  });
  it("rejects non-JSON or bad kind", () => {
    expect(parseCapture("hello there")).toBeNull();
    expect(parseCapture('{"kind":"xyz","title":"x"}')).toBeNull();
  });
});

describe("localParse", () => {
  it("routes a timed note to an event", () => {
    const r = localParse("Lunch with Sam Thursday 1pm", "2026-05-24");
    expect(r.kind).toBe("event");
    expect(r.start).toBe("13:00");
  });
  it("routes a plain note to a task", () => {
    expect(localParse("Renew the domain", "2026-05-24").kind).toBe("task");
  });
});

describe("applyCapture", () => {
  const mk = () => {
    const store = new Store(new InMemoryAdapter());
    return { store, tasks: new TasksService(store, "u1"), schedule: new ScheduleService(store, "u1"), notes: new NotesService(store, "u1") };
  };
  it("files a task with a resolved category", async () => {
    const s = mk();
    await applyCapture({ kind: "task", title: "Email Sam", category: "Work" }, s, CATS, "2026-05-24");
    const t = await s.tasks.listTasks();
    expect(t.length).toBe(1);
    expect(t[0]!.data.category).toBe("c1");
  });
  it("files an event and a note", async () => {
    const s = mk();
    await applyCapture({ kind: "event", title: "Standup", start: "09:00" }, s, CATS, "2026-05-24");
    await applyCapture({ kind: "note", title: "Idea" }, s, CATS, "2026-05-24");
    expect((await s.schedule.listEvents()).length).toBe(1);
    expect((await s.notes.listNotes()).length).toBe(1);
  });
});
