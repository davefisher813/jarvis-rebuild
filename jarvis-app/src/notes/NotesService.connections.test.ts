import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect } from "vitest";
import { NotesService } from "./NotesService";

describe("NotesService note linking", () => {
  it("adds a link with targetId, lists it, then removes it", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const noteId = (await svc.createNote("Plan", "c1"))!;
    const connId = (await svc.addConnection(noteId, "event", "Kickoff", null, "evt_1"))!;
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
    await svc.addConnection(noteId, "project", "Website Redesign", null, "prj_1");
    await svc.addConnection(noteId, "person", "Sam Rivera", null, "per_1");
    await svc.addConnection(noteId, "goal", "Ship v2", null, "goal_1");
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
    await svc.addConnection(a, "project", "P", null, "prj_9");
    await svc.addConnection(b, "project", "P", null, "prj_9");
    const linked = await svc.notesLinkedTo("prj_9");
    expect(linked.map((n) => n.title).sort()).toEqual(["Alpha", "Beta"]);
    expect(await svc.notesLinkedTo("nope")).toEqual([]);
  });
});
