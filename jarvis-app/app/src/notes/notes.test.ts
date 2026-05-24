import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./NotesService";
import { STEPS, REQUIREMENTS, type Ctx } from "./notesSpec";

function freshService(): NotesService {
  return new NotesService(new Store(new InMemoryAdapter()), "u1");
}

// The approved 18-step Notes contract, run against the real NotesService.
// Same definitions that drove the harness, so harness and code cannot drift.
describe("Notes Upgrade: approved 18-step contract", () => {
  const svc = freshService();
  const ctx: Ctx = {};
  const covered = new Set<string>();

  for (const step of STEPS) {
    it(`[${step.covers.join(",")}] ${step.label}`, async () => {
      const r = await step.run(svc, ctx);
      expect(r.ok, r.msg).toBe(true);
      if (r.ok) step.covers.forEach((c) => covered.add(c));
    });
  }

  it("coverage complete: every requirement covered by a passing step", () => {
    const missing = REQUIREMENTS.filter((r) => !covered.has(r.id));
    expect(missing.length, `Uncovered: ${missing.map((m) => m.id).join(", ")}`).toBe(0);
  });
});

// Permanent guards on fresh services (cannot be masked by sequence state).
describe("Notes permanent guard: tombstone (R12)", () => {
  it("a deleted note never returns", async () => {
    const svc = freshService();
    const id = (await svc.createNote("kill me", "health"))!;
    expect(await svc.note(id)).not.toBeNull();
    await svc.deleteNote(id);
    expect(await svc.note(id)).toBeNull();
    expect((await svc.listNotes()).length).toBe(0);
  });
});

describe("Notes permanent guard: sync loss (R17)", () => {
  it("an offline title edit is held then applied on reconnect", async () => {
    const svc = freshService();
    const id = (await svc.createNote("before", "tucci"))!;
    svc.goOffline();
    await svc.editTitle(id, "after");
    expect(svc.queueLen()).toBe(1);
    expect((await svc.note(id))?.title).toBe("before");
    await svc.reconnect();
    expect(svc.queueLen()).toBe(0);
    expect((await svc.note(id))?.title).toBe("after");
  });
});

describe("Notes permanent guard: tasks survive note deletion (R13)", () => {
  it("tasks created from a checklist outlive the note", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    await svc.addChecklist(id, ["a", "b"]);
    const made = await svc.tasksFromChecklist(id);
    expect(made.length).toBe(2);
    await svc.deleteNote(id);
    expect((await svc.listTasks()).length).toBe(2);
  });
});
