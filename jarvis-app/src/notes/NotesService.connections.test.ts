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
});
