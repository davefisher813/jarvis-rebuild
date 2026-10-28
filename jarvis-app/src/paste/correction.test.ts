import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { correctionLead, resolveCorrection, applyCorrection } from "./correction";
import type { SavedEntity } from "./smartPaste";

// A CORRECTION EDITS THE ITEM JUST CAPTURED (Dave, 2026-10-27: "no, Josh Rudd" was saved as a second bogus task).
const PEOPLE = [
  { id: "jb", name: "Josh (Bucknell)" },
  { id: "jr", name: "Josh Rudd" },
  { id: "mom", name: "Linda Fisher", aliases: ["Mom"] },
];

describe("correctionLead: what opens like a correction", () => {
  it("a rejection needs its punctuation, so a real line that starts with the word no is still a capture", () => {
    expect(correctionLead("no, Josh Rudd")).toEqual({ how: "reject", rest: "Josh Rudd" });
    expect(correctionLead("No. Josh Rudd")).toEqual({ how: "reject", rest: "Josh Rudd" });
    expect(correctionLead("nope - nobody")).toEqual({ how: "reject", rest: "nobody" });
    expect(correctionLead("No meeting Friday")).toBeNull();
    expect(correctionLead("Nobody called back")).toBeNull();
    expect(correctionLead("Call Josh Rudd")).toBeNull();
  });
  it("a bare no or wrong is a rejection with nothing after it", () => {
    expect(correctionLead("no")).toEqual({ how: "reject", rest: "" });
    expect(correctionLead("Wrong!")).toEqual({ how: "reject", rest: "" });
  });
  it("I meant and should be say what it is", () => {
    expect(correctionLead("I meant Josh Rudd")).toEqual({ how: "say", rest: "Josh Rudd" });
    expect(correctionLead("change it to Call Dana")).toEqual({ how: "say", rest: "Call Dana" });
  });
  it("a pasted block is never a correction", () => {
    expect(correctionLead("no, a\nb")).toBeNull();
    expect(correctionLead("no, " + "x".repeat(200))).toBeNull();
  });
});

describe("resolveCorrection: exact names only", () => {
  const lead = (rest: string, how: "reject" | "say" = "reject") => ({ how, rest });
  it("an exact name or alias is the person", () => {
    expect(resolveCorrection(lead("Josh Rudd"), PEOPLE)).toEqual({ kind: "person", personId: "jr", name: "Josh Rudd" });
    expect(resolveCorrection(lead("it's Josh Rudd."), PEOPLE)).toMatchObject({ kind: "person", personId: "jr" });
    expect(resolveCorrection(lead("mom"), PEOPLE)).toMatchObject({ kind: "person", personId: "mom" });
  });
  it("a first name alone names nobody", () => {
    expect(resolveCorrection(lead("Josh"), PEOPLE)).toEqual({ kind: "unresolved" });
  });
  it("nobody takes the person off", () => {
    expect(resolveCorrection(lead("nobody"), PEOPLE)).toEqual({ kind: "unlink" });
    expect(resolveCorrection(lead("no one"), PEOPLE)).toEqual({ kind: "unlink" });
  });
  it("only an explicit lead-in retitles, and a bare rejection that matches nobody changes nothing", () => {
    expect(resolveCorrection(lead("call dana", "say"), PEOPLE)).toEqual({ kind: "retitle", title: "Call Dana" });
    expect(resolveCorrection(lead("Dana Smith"), PEOPLE)).toEqual({ kind: "unresolved" });
    expect(resolveCorrection(lead(""), PEOPLE)).toEqual({ kind: "unresolved" });
  });
  it("two contacts with the same name name nobody", () => {
    expect(resolveCorrection(lead("Josh Rudd"), [...PEOPLE, { id: "jr2", name: "josh rudd" }])).toEqual({ kind: "unresolved" });
  });
});

describe("applyCorrection edits the record and can be undone", () => {
  const setup = async () => {
    const store = new Store(new InMemoryAdapter());
    const tasks = new TasksService(store, "u");
    const schedule = new ScheduleService(store, "u");
    return { tasks, schedule };
  };

  it("a task takes the person, then gives the old one back on Undo", async () => {
    const { tasks, schedule } = await setup();
    const id = (await tasks.createTask("Text Josh Rudd"))!;
    await tasks.setPerson(id, "jb");
    const s: SavedEntity = { id, kind: "task", title: "Text Josh Rudd", personId: "jb" };
    const f = (await applyCorrection({ kind: "person", personId: "jr", name: "Josh Rudd" }, s, { tasks, schedule }))!;
    expect((await tasks.task(id))?.personId).toBe("jr");
    expect(f.entity.personId).toBe("jr");
    expect(f.words).toBe("Fixed: Text Josh Rudd · With Josh Rudd");
    await f.undo();
    expect((await tasks.task(id))?.personId).toBe("jb");
  });

  it("unlink takes the person off a task and an event", async () => {
    const { tasks, schedule } = await setup();
    const id = (await tasks.createTask("Text Josh Rudd"))!;
    await tasks.setPerson(id, "jb");
    const f = (await applyCorrection({ kind: "unlink" }, { id, kind: "task", title: "Text Josh Rudd", personId: "jb" }, { tasks, schedule }))!;
    expect((await tasks.task(id))?.personId).toBeUndefined();
    expect(f.entity.personId).toBeUndefined();
    await f.undo();
    expect((await tasks.task(id))?.personId).toBe("jb");

    const ev = (await schedule.createEvent("Lunch", { date: "2026-10-30", start: "12:00", personId: "jb" }))!;
    const g = (await applyCorrection({ kind: "person", personId: "jr", name: "Josh Rudd" }, { id: ev, kind: "event", title: "Lunch", personId: "jb" }, { tasks, schedule }))!;
    expect((await schedule.event(ev))?.personId).toBe("jr");
    await g.undo();
    expect((await schedule.event(ev))?.personId).toBe("jb");
  });

  it("a retitle edits a task's words and Undo restores them", async () => {
    const { tasks, schedule } = await setup();
    const id = (await tasks.createTask("Text Josh"))!;
    const f = (await applyCorrection({ kind: "retitle", title: "Text Josh Rudd" }, { id, kind: "task", title: "Text Josh" }, { tasks, schedule }))!;
    expect((await tasks.task(id))?.text).toBe("Text Josh Rudd");
    await f.undo();
    expect((await tasks.task(id))?.text).toBe("Text Josh");
  });

  it("anything it cannot edit is null and writes nothing", async () => {
    const { tasks, schedule } = await setup();
    expect(await applyCorrection({ kind: "unresolved" }, { id: "x", kind: "task", title: "t" }, { tasks, schedule })).toBeNull();
    expect(await applyCorrection({ kind: "person", personId: "jr", name: "Josh Rudd" }, { id: "n1", kind: "note", title: "n" }, { tasks, schedule })).toBeNull();
    expect(await applyCorrection({ kind: "retitle", title: "x" }, { id: "e1", kind: "event", title: "e" }, { tasks, schedule })).toBeNull();
  });
});
