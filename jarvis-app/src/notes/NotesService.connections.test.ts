import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect } from "vitest";
import { NotesService } from "./NotesService";

describe("NotesService note linking", () => {
  it("adds a link with targetId, lists it, then removes it", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const noteId = (await svc.createNote("Plan", "c1"))!;
    const connId = (await svc.addConnection(noteId, "event", "Kickoff", "evt_1"))!;
    let note = (await svc.note(noteId))!;
    expect(note.connections.length).toBe(1);
    expect(note.connections[0]!.kind).toBe("event");
    expect(note.connections[0]!.label).toBe("Kickoff");
    expect(note.connections[0]!.targetId).toBe("evt_1");
    expect(await svc.removeConnection(noteId, connId)).toBe(true);
    note = (await svc.note(noteId))!;
    expect(note.connections.length).toBe(0);
  });

  it("links a note to a project, person, and goal, each keeping its targetId", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const noteId = (await svc.createNote("Plan", "c1"))!;
    await svc.addConnection(noteId, "project", "Website Redesign", "prj_1");
    await svc.addConnection(noteId, "person", "Sam Rivera", "per_1");
    await svc.addConnection(noteId, "goal", "Ship v2", "goal_1");
    const note = (await svc.note(noteId))!;
    const byKind = Object.fromEntries(note.connections.map((c) => [c.kind, c]));
    expect(byKind.project!.targetId).toBe("prj_1");
    expect(byKind.person!.targetId).toBe("per_1");
    expect(byKind.goal!.targetId).toBe("goal_1");
    expect(byKind.person!.label).toBe("Sam Rivera");
  });

  it("notesLinkedTo finds every note pointing at an entity", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const a = (await svc.createNote("Alpha", "c1"))!;
    const b = (await svc.createNote("Beta", "c1"))!;
    await svc.createNote("Gamma", "c1"); // links to nothing
    await svc.addConnection(a, "project", "P", "prj_9");
    await svc.addConnection(b, "project", "P", "prj_9");
    const linked = await svc.notesLinkedTo("prj_9");
    expect(linked.map((n) => n.title).sort()).toEqual(["Alpha", "Beta"]);
    expect(await svc.notesLinkedTo("nope")).toEqual([]);
  });
});

// UP-CORE-16 (2026-09-05): meeting notes produce action items one at a time,
// and the only way out of the note was the bulk screen, which promotes the
// whole list. One line, promoted where it sits, with the same rules
// tasksFromChecklist has always applied.
describe("promoting one checklist line (UP-CORE-16)", () => {
  const mk = async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u-promote");
    const noteId = (await svc.createNote("Team sync", "family"))!;
    const blockId = (await svc.addBlock(noteId, { type: "checklist", items: [
      { text: "Email the coach", done: false },
      { text: "", done: false },
    ] }))!;
    return { svc, noteId, blockId };
  };

  it("makes one task, files it under the note's area, and links both ways", async () => {
    const { svc, noteId, blockId } = await mk();
    const taskId = (await svc.taskFromChecklistItem(noteId, blockId, 0))!;
    expect(taskId).toBeTruthy();
    const tasks = await svc.listTasks();
    const made = tasks.find((t) => t.id === taskId)!;
    expect((made.data as { text: string }).text).toBe("Email the coach");
    expect((made.data as { category: string }).category).toBe("family");
    expect((made.data as { fromNote: string }).fromNote).toBe(noteId);
    expect((made.data as { source: { type: string } }).source.type).toBe("note");
    const note = (await svc.note(noteId))!;
    const items = note.blocks.find((b) => b.id === blockId)!.items as { text: string; taskId?: string }[];
    expect(items[0]!.taskId).toBe(taskId);
    expect(note.connections.some((c) => c.kind === "task" && c.targetId === taskId)).toBe(true);
    // The line beside it is untouched: this promotes ONE.
    expect(items[1]!.taskId).toBeUndefined();
  });

  it("refuses a blank line and a line already promoted", async () => {
    const { svc, noteId, blockId } = await mk();
    expect(await svc.taskFromChecklistItem(noteId, blockId, 1)).toBeNull();
    await svc.taskFromChecklistItem(noteId, blockId, 0);
    expect(await svc.taskFromChecklistItem(noteId, blockId, 0)).toBeNull();
    expect((await svc.listTasks()).length).toBe(1);
  });

  it("undo takes the line back to unlinked and drops the connection", async () => {
    const { svc, noteId, blockId } = await mk();
    await svc.taskFromChecklistItem(noteId, blockId, 0);
    expect(await svc.unlinkChecklistItem(noteId, blockId, 0)).toBe(true);
    const note = (await svc.note(noteId))!;
    const items = note.blocks.find((b) => b.id === blockId)!.items as { text: string; taskId?: string }[];
    expect(items[0]!.taskId).toBeUndefined();
    expect(items[0]!.text).toBe("Email the coach");
    expect(note.connections.some((c) => c.kind === "task")).toBe(false);
  });
});
