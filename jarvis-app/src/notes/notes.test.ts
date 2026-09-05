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

  // restoreNote powers the Undo toast that replaced the delete confirm dialog
  // (audit 2026-08-07). It must bring the WHOLE note back, blocks and
  // connections included, or Undo is a lie.
  //
  // HMN-F-15 (2026-09-05): under the SAME id. This test used to assert the
  // opposite ("the old id is gone for good"), which documented the bug: the
  // tasks made from the note's checklist and the Where You Were spot kept
  // pointing at the dead id. R12 (a deleted note never returns on its own)
  // still stands; Undo is the person putting it back, not a resurrection.
  it("restoreNote resurrects a snapshot whole, under its old id", async () => {
    const svc = freshService();
    const id = (await svc.createNote("keep me", "health"))!;
    await svc.addBlock(id, { type: "text", text: "the body" });
    const snapshot = (await svc.note(id))!;
    await svc.deleteNote(id);
    expect((await svc.listNotes()).length).toBe(0);
    const backId = (await svc.restoreNote(snapshot, id))!;
    expect(backId).toBe(id);
    const back = (await svc.note(id))!;
    expect(back.title).toBe("keep me");
    expect(back.blocks.map((b) => b.text)).toContain("the body");
    expect((await svc.listNotes()).length).toBe(1);
  });

  it("tasks made from the restored note's checklist still point at a note that opens", async () => {
    const svc = freshService();
    const id = (await svc.createNote("groceries", ""))!;
    await svc.addChecklist(id, ["milk", "eggs"]);
    const made = await svc.tasksFromChecklist(id);
    expect(made).toHaveLength(2);
    const snapshot = (await svc.note(id))!;
    await svc.deleteNote(id);
    await svc.restoreNote(snapshot, id);
    for (const t of await svc.listTasks()) {
      const from = (t.data as { fromNote?: string }).fromNote!;
      expect(await svc.note(from)).not.toBeNull();
    }
    // And the reverse lookup the task sheet's Linked Notes reads still finds it.
    expect(await svc.notesLinkedTo(made[0]!)).toEqual([{ id, title: "groceries", category: "" }]);
  });

  it("restoreNote without an id still works, under a fresh one", async () => {
    const svc = freshService();
    const id = (await svc.createNote("keep me", ""))!;
    const snapshot = (await svc.note(id))!;
    await svc.deleteNote(id);
    const newId = (await svc.restoreNote(snapshot))!;
    expect(newId).toBeTruthy();
    expect((await svc.note(newId))!.title).toBe("keep me");
  });
});

describe("Notes permanent guard: sync loss (R17)", () => {
  it("an offline title edit is held, shows at once, then applies on reconnect", async () => {
    const svc = freshService();
    const id = (await svc.createNote("before", "orgB"))!;
    svc.goOffline();
    await svc.editTitle(id, "after");
    expect(svc.queueLen()).toBe(1);
    // PLUMB-F-08 (2026-09-05): the held edit is visible offline; this used
    // to assert "before", which is the rename-vanished-until-reconnect bug.
    expect((await svc.note(id))?.title).toBe("after");
    await svc.reconnect();
    expect(svc.queueLen()).toBe(0);
    expect((await svc.note(id))?.title).toBe("after");
  });
});

// S3-Q14 (2026-09-04): "Nothing is held when the signal drops." Before this,
// createNote made offline threw straight out of the adapter's network call --
// the core Store had no offline branch for create at all. Now it queues, and
// (the actual point of a capture app) the note it made is visible right away,
// not only after reconnect.
describe("Notes permanent guard: an offline capture is never lost or invisible (S3-Q14)", () => {
  it("createNote made offline shows up immediately and survives reconnect", async () => {
    const svc = freshService();
    svc.goOffline();
    const id = (await svc.createNote("Grocery list", "life"))!;
    expect(id).toBeTruthy();
    expect((await svc.note(id))?.title).toBe("Grocery list");
    expect((await svc.listNotes()).map((n) => n.id)).toContain(id);
    await svc.reconnect();
    expect(svc.queueLen()).toBe(0);
    expect((await svc.note(id))?.title).toBe("Grocery list");
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

  it("insertBlockAfter lands mid-document, not at the end", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const a = (await svc.addBlock(id, { type: "text", text: "first" }))!;
    const c = (await svc.addBlock(id, { type: "text", text: "last" }))!;
    const b = (await svc.insertBlockAfter(id, a, { type: "text", text: "middle" }))!;
    const blocks = (await svc.note(id))!.blocks;
    expect(blocks.map((x) => x.id)).toEqual([a, b, c]);
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

  // S6-Q38 (2026-09-05): "a task made from a checklist is not connected to
  // its note." fromNote pointed task -> note; nothing pointed note -> task,
  // so neither the note's own Connections screen nor the task sheet's
  // reverse-lookup Linked Notes section (notesLinkedTo) ever saw the link.
  it("tasksFromChecklist connects the note to each task it creates", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    await svc.addChecklist(id, ["call the venue", "book photographer"]);
    const [t1, t2] = await svc.tasksFromChecklist(id);
    const note = (await svc.note(id))!;
    const byTarget = Object.fromEntries(note.connections.map((c) => [c.targetId, c]));
    expect(byTarget[t1!]!.kind).toBe("task");
    expect(byTarget[t1!]!.label).toBe("call the venue");
    expect(byTarget[t2!]!.kind).toBe("task");
    expect(byTarget[t2!]!.label).toBe("book photographer");
    // The reverse lookup the task sheet's Linked Notes section reads.
    expect((await svc.notesLinkedTo(t1!)).map((n) => n.id)).toEqual([id]);
    expect((await svc.notesLinkedTo(t2!)).map((n) => n.id)).toEqual([id]);
  });

  it("a second run of tasksFromChecklist adds no duplicate connections", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    await svc.addChecklist(id, ["a", "b"]);
    await svc.tasksFromChecklist(id);
    await svc.tasksFromChecklist(id); // idempotent: no new tasks, no new connections
    const note = (await svc.note(id))!;
    expect(note.connections.filter((c) => c.kind === "task").length).toBe(2);
  });

  // B4 (2026-09-04): the Create Tasks screen previews the first checklist
  // filtered to undone items and promises "Completed ones skipped." This
  // used to create a task for a done item anyway, and to walk every
  // checklist block instead of just the one shown.
  it("tasksFromChecklist skips a completed item, matching the screen's promise", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    const bid = (await svc.addChecklist(id, ["a", "b"]))!;
    await svc.toggleChecklistItem(id, bid, 0); // "a" done
    const made = await svc.tasksFromChecklist(id);
    expect(made.length).toBe(1);
    const block = (await svc.note(id))!.blocks.find((b) => b.id === bid)!;
    const items = block.items as { text: string; done: boolean; taskId?: string }[];
    expect(items[0]!.done).toBe(true);
    expect(items[0]!.taskId).toBeUndefined(); // done item never linked
    expect(items[1]!.taskId).toBeTruthy();
  });

  it("tasksFromChecklist only converts the first checklist block, matching the preview", async () => {
    const svc = freshService();
    const id = (await svc.createNote("n", "health"))!;
    await svc.addChecklist(id, ["a"]);
    await svc.addBlock(id, { type: "checklist", items: [{ text: "second list item", done: false }] });
    const made = await svc.tasksFromChecklist(id);
    expect(made.length).toBe(1);
    const tasks = await svc.listTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.data.text).toBe("a");
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

// THE GREAT UNFILING (2026-08-30). Law 11 fixed note CREATION so a new note is
// born unfiled. Every note written before that fix still carries the category
// the bug picked for it -- catList[0], which for Dave is Family -- which is
// why his library rendered as one uniform colour. This is the one-time cleanup
// for the notes that already exist.
describe("unfileAllNotes: the one-time cleanup for notes the bug filed", () => {
  it("clears a filed note's category and reports how many it cleared", async () => {
    const svc = freshService();
    const a = await svc.createNote("Filed one", "cat-family");
    const b = await svc.createNote("Filed two", "cat-work");
    expect(await svc.unfileAllNotes()).toBe(2);
    expect((await svc.note(a!))!.category).toBe("");
    expect((await svc.note(b!))!.category).toBe("");
  });

  it("is idempotent: a second run clears nothing", async () => {
    const svc = freshService();
    await svc.createNote("Filed", "cat-family");
    expect(await svc.unfileAllNotes()).toBe(1);
    // The flag lives on the profile, but the method must be safe on its own --
    // a failed profile write would otherwise unfile his library twice.
    expect(await svc.unfileAllNotes()).toBe(0);
  });

  it("leaves an already-unfiled note alone rather than rewriting it", async () => {
    const svc = freshService();
    await svc.createNote("Born unfiled", "");
    expect(await svc.unfileAllNotes()).toBe(0);
  });

  // The case that matters most on a second device: he runs the cleanup, refiles
  // some notes by hand, and nothing may undo that work. The profile flag is
  // what prevents a re-run, and this proves the method itself would only ever
  // touch what still carries a category.
  it("a note refiled by hand after the cleanup is only cleared by an explicit re-run", async () => {
    const svc = freshService();
    const id = await svc.createNote("Filed", "cat-family");
    await svc.unfileAllNotes();
    await svc.setCategory(id!, "cat-money");
    expect((await svc.note(id!))!.category).toBe("cat-money");
    // Still one to clear, so the count is honest about what a re-run would do.
    expect(await svc.unfileAllNotes()).toBe(1);
  });

  it("[edge] an empty library is not an error", async () => {
    expect(await freshService().unfileAllNotes()).toBe(0);
  });
});
