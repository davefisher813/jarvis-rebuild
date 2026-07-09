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

describe("Notes editing helpers", () => {
  it("toggleChecklistItem flips done and persists", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a", "b"]))!;
    expect(await svc.toggleChecklistItem(id, bid, 0)).toBe(true);
    const note = await svc.note(id);
    const block = note!.blocks.find((b) => b.id === bid)!;
    const items = block.items as { text: string; done: boolean }[];
    expect(items[0]!.done).toBe(true);
    expect(items[1]!.done).toBe(false);
  });

  it("toggle then toggle again returns to not-done", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a"]))!;
    await svc.toggleChecklistItem(id, bid, 0);
    await svc.toggleChecklistItem(id, bid, 0);
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    expect((block.items as { done: boolean }[])[0]!.done).toBe(false);
  });

  it("addChecklistItem appends a blank item and returns its index", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a"]))!;
    const idx = await svc.addChecklistItem(id, bid);
    expect(idx).toBe(1);
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    const items = block.items as { text: string }[];
    expect(items.length).toBe(2);
    expect(items[1]!.text).toBe("");
  });

  it("deleteChecklistItem removes the item so no empty box remains", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a", "b", "c"]))!;
    expect(await svc.deleteChecklistItem(id, bid, 1)).toBe(true);
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    const items = block.items as { text: string }[];
    expect(items.map((i) => i.text)).toEqual(["a", "c"]);
  });

  it("moveBlock reorders blocks", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const b1 = (await svc.addBlock(id, { type: "heading", text: "first" }))!;
    const b2 = (await svc.addBlock(id, { type: "heading", text: "second" }))!;
    expect(await svc.moveBlock(id, 0, 1)).toBe(true);
    const blocks = (await svc.note(id))!.blocks;
    expect(blocks[0]!.id).toBe(b2);
    expect(blocks[1]!.id).toBe(b1);
  });

  it("deleteBlock removes a block", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const b1 = (await svc.addBlock(id, { type: "heading", text: "keep" }))!;
    const b2 = (await svc.addBlock(id, { type: "heading", text: "drop" }))!;
    expect(await svc.deleteBlock(id, b2)).toBe(true);
    const blocks = (await svc.note(id))!.blocks;
    expect(blocks.map((b) => b.id)).toEqual([b1]);
  });

  it("tasksFromChecklist is idempotent and back-links taskIds", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a", "b"]))!;
    const first = await svc.tasksFromChecklist(id);
    expect(first.length).toBe(2);
    const second = await svc.tasksFromChecklist(id);
    expect(second.length).toBe(0); // no duplicates on a second run
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    const items = block.items as { taskId?: string }[];
    expect(items.every((i) => !!i.taskId)).toBe(true);
  });

  it("toggling a promoted item updates its task; reconcile pulls task state back", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a"]))!;
    const [tid] = await svc.tasksFromChecklist(id);
    // note -> task
    await svc.toggleChecklistItem(id, bid, 0);
    let tasks = await svc.listTasks();
    expect((tasks.find((t) => t.id === tid)!.data as { done?: boolean }).done).toBe(true);
    // task -> note (flip the task off, reconcile, item follows)
    await svc.toggleChecklistItem(id, bid, 0); // back to false (also sets task false)
    tasks = await svc.listTasks();
    expect((tasks.find((t) => t.id === tid)!.data as { done?: boolean }).done).toBe(false);
  });

  it("setChecklistItemText updates the item text", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a"]))!;
    expect(await svc.setChecklistItemText(id, bid, 0, "edited")).toBe(true);
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    expect((block.items as { text: string }[])[0]!.text).toBe("edited");
  });

  it("toggle on a missing block is a safe no-op", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    expect(await svc.toggleChecklistItem(id, "nope", 0)).toBe(false);
  });
});
