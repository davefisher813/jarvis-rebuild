import { describe, it, expect } from "vitest";
import { foundFromReply, findInNote, FOUND_CAP, PASS_DELTA } from "./jarvisFound";
import type { NoteData } from "./types";

// C-20 (Astra, 2026-09-12).
const PEOPLE = [{ id: "p1", name: "Alberto Martinez" }, { id: "p2", name: "Marco Rossi" }, { id: "p3", name: "Marco Bianchi" }];
const PROJECTS = [{ id: "j1", title: "Gym entry flow" }, { id: "j2", title: "Facility pricing" }];

describe("foundFromReply", () => {
  it("keeps tasks and decisions as said, and links only the people and projects it can match once", () => {
    const raw = JSON.stringify({
      tasks: [{ text: "Send Alberto revised pricing", due: "by Friday" }, { text: "  " }],
      decisions: [{ text: "Three-tier membership from Oct 1" }],
      people: [{ name: "Alberto" }, { name: "Marco" }, { name: "Nobody Known" }],
      projects: [{ title: "gym entry" }, { title: "Moon base" }],
    });
    expect(foundFromReply(raw, PEOPLE, PROJECTS)).toEqual([
      { kind: "task", text: "Send Alberto revised pricing", due: "by Friday" },
      { kind: "decision", text: "Three-tier membership from Oct 1" },
      { kind: "person", text: "Alberto Martinez", targetId: "p1" },
      { kind: "project", text: "Gym entry flow", targetId: "j1" },
    ]);
  });

  it("caps at six, drops duplicates, and survives a reply that is not JSON", () => {
    const raw = JSON.stringify({ tasks: Array.from({ length: 9 }, (_, i) => ({ text: "Task " + (i % 7) })), decisions: [], people: [], projects: [] });
    const out = foundFromReply(raw, [], []);
    expect(out.length).toBe(FOUND_CAP);
    expect(new Set(out.map((c) => c.text)).size).toBe(FOUND_CAP);
    expect(foundFromReply("not json", [], [])).toEqual([]);
  });
});

describe("findInNote", () => {
  const note: NoteData = { title: "Meeting with Alberto", category: "", connections: [], blocks: [{ id: "b", type: "text", text: "Finalize facility pricing and simplify the gym entry flow. Send Alberto revised pricing by Friday." }] };
  it("never calls the model when AI is off, and sends only the note text", async () => {
    let sent: unknown = null;
    const ai = { available: false, complete: async (m: unknown) => { sent = m; return "{}"; } };
    expect(await findInNote(ai, note, PEOPLE, PROJECTS)).toEqual([]);
    expect(sent).toBeNull();
  });
  it("with AI on, the call is background, structured, and carries no names list", async () => {
    let seen: { messages: unknown; opts: unknown } | null = null;
    const ai = { available: true, complete: async (messages: unknown, _s: unknown, opts: unknown) => { seen = { messages, opts }; return JSON.stringify({ tasks: [], decisions: [], people: [{ name: "Alberto" }], projects: [] }); } };
    const out = await findInNote(ai, note, PEOPLE, PROJECTS);
    expect(out).toEqual([{ kind: "person", text: "Alberto Martinez", targetId: "p1" }]);
    const s = seen as unknown as { messages: { content: string }[]; opts: { background: boolean; schema: unknown; kind: string } };
    expect(s.opts.background).toBe(true);
    expect(s.opts.kind).toBe("note_found");
    expect(s.opts.schema).toBeTruthy();
    expect(s.messages[0]!.content).not.toContain("Marco Rossi");
    expect(PASS_DELTA).toBe(40);
  });
});
