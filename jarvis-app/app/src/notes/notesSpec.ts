import type { NotesService } from "./NotesService";
import type { NoteData } from "./types";

// SINGLE SOURCE (real-code side): the 18 steps approved in the Notes harness,
// mirrored against the real NotesService. Same behaviors and assertions; async
// because the real service is async. notes.test.ts runs these in order.

export interface Ctx {
  id?: string;
  id2?: string;
  hId?: string;
  tId?: string;
  clId?: string;
  connId?: string;
  taskIds?: string[];
}

export interface StepResult {
  ok: boolean;
  msg: string;
}

export interface Step {
  kind: "core" | "edge";
  covers: string[];
  label: string;
  run(s: NotesService, c: Ctx): Promise<StepResult>;
}

export interface Requirement {
  id: string;
  text: string;
}

export const REQUIREMENTS: Requirement[] = [
  { id: "R1", text: "Create a note" },
  { id: "R2", text: "Add blocks of different types (heading, text, checklist)" },
  { id: "R3", text: "Edit a block's content" },
  { id: "R4", text: "Reorder blocks" },
  { id: "R5", text: "Delete a block" },
  { id: "R6", text: "Create tasks from a checklist, linked, inheriting category" },
  { id: "R7", text: "Add a connection" },
  { id: "R8", text: "Remove a connection" },
  { id: "R9", text: "Edit the title" },
  { id: "R10", text: "Apply a template (seeds blocks)" },
  { id: "R11", text: "Delete a note (hard delete)" },
  { id: "R12", text: "Deleted note never returns after reload (tombstone)" },
  { id: "R13", text: "Tasks survive note deletion" },
  { id: "R14", text: "Empty title rejected" },
  { id: "R15", text: "Deleting a note twice does not crash" },
  { id: "R16", text: "Empty checklist creates zero tasks" },
  { id: "R17", text: "Offline edit then reconnect, no loss" },
  { id: "R18", text: "Delete missing block / remove missing connection is a safe no-op" },
];

const data = (n: NoteData | null) => n as NoteData;

export const STEPS: Step[] = [
  {
    kind: "core", covers: ["R1"], label: "Create a note",
    async run(s, c) {
      c.id = (await s.createNote("Marathon Plan V3", "health")) ?? undefined;
      const notes = await s.listNotes();
      const n = await s.note(c.id!);
      const ok = !!c.id && notes.length === 1 && n?.title === "Marathon Plan V3" && n?.category === "health";
      return { ok, msg: ok ? "Note created." : "Note not created correctly." };
    },
  },
  {
    kind: "core", covers: ["R2"], label: "Add heading + text + checklist",
    async run(s, c) {
      c.hId = (await s.addBlock(c.id!, { type: "heading", text: "This Week" })) ?? undefined;
      c.tId = (await s.addBlock(c.id!, { type: "text", text: "Peak week is 48 miles." })) ?? undefined;
      c.clId = (await s.addChecklist(c.id!, ["Easy 6 miles", "Foam roll", "Log mileage"])) ?? undefined;
      const bl = data(await s.note(c.id!)).blocks;
      const ok =
        bl.length === 3 && bl[0]!.type === "heading" && bl[1]!.type === "text" &&
        bl[2]!.type === "checklist" && (bl[2]!.items as unknown[]).length === 3;
      return { ok, msg: ok ? "3 blocks of right types." : "Blocks wrong." };
    },
  },
  {
    kind: "core", covers: ["R3"], label: "Edit the heading block",
    async run(s, c) {
      const ok = (await s.editBlock(c.id!, c.hId!, { text: "Peak Week" })) &&
        data(await s.note(c.id!)).blocks.find((b) => b.id === c.hId)?.text === "Peak Week";
      return { ok, msg: ok ? "Block updated." : "Block edit failed." };
    },
  },
  {
    kind: "core", covers: ["R4"], label: "Reorder checklist to top",
    async run(s, c) {
      const bl = data(await s.note(c.id!)).blocks;
      const from = bl.findIndex((b) => b.id === c.clId);
      const ok = (await s.moveBlock(c.id!, from, 0)) &&
        data(await s.note(c.id!)).blocks[0]!.id === c.clId;
      return { ok, msg: ok ? "Reordered." : "Reorder failed." };
    },
  },
  {
    kind: "core", covers: ["R5"], label: "Delete the text block",
    async run(s, c) {
      const ok = (await s.deleteBlock(c.id!, c.tId!)) &&
        (await s.note(c.id!))!.blocks.length === 2 &&
        !data(await s.note(c.id!)).blocks.some((b) => b.id === c.tId);
      return { ok, msg: ok ? "Block deleted." : "Block not removed." };
    },
  },
  {
    kind: "core", covers: ["R6"], label: "Create tasks from the checklist",
    async run(s, c) {
      c.taskIds = await s.tasksFromChecklist(c.id!);
      const tasks = await s.listTasks();
      const ok = tasks.length === 3 &&
        tasks.every((t) => (t.data as { fromNote?: string; category?: string }).fromNote === c.id &&
          (t.data as { category?: string }).category === "health");
      return { ok, msg: ok ? "3 linked tasks, category inherited." : "Tasks wrong." };
    },
  },
  {
    kind: "core", covers: ["R7"], label: "Add a connection",
    async run(s, c) {
      c.connId = (await s.addConnection(c.id!, "event", "Long Run Sunday", "health")) ?? undefined;
      const ok = !!c.connId && data(await s.note(c.id!)).connections.length === 1;
      return { ok, msg: ok ? "Connection added." : "Connection not added." };
    },
  },
  {
    kind: "core", covers: ["R8"], label: "Remove the connection",
    async run(s, c) {
      const ok = (await s.removeConnection(c.id!, c.connId!)) &&
        data(await s.note(c.id!)).connections.length === 0;
      return { ok, msg: ok ? "Connection removed." : "Connection not removed." };
    },
  },
  {
    kind: "core", covers: ["R9"], label: "Edit the title",
    async run(s, c) {
      await s.editTitle(c.id!, "Marathon Plan V4");
      const ok = (await s.note(c.id!))?.title === "Marathon Plan V4";
      return { ok, msg: ok ? "Title updated." : "Title not updated." };
    },
  },
  {
    kind: "core", covers: ["R10"], label: "Apply Meeting Notes template (new note)",
    async run(s, c) {
      c.id2 = (await s.createNote("Team Sync", "tucci")) ?? undefined;
      const okApply = await s.applyTemplate(c.id2!, "meeting");
      const bl = data(await s.note(c.id2!)).blocks;
      const ok = okApply && bl.length === 3 && bl[0]!.type === "heading";
      return { ok, msg: ok ? "Template seeded blocks." : "Template failed." };
    },
  },
  {
    kind: "core", covers: ["R11"], label: "Delete the marathon note",
    async run(s, c) {
      await s.deleteNote(c.id!);
      const ok = !(await s.listNotes()).some((n) => n.id === c.id);
      return { ok, msg: ok ? "Note removed." : "Note still present." };
    },
  },
  {
    kind: "core", covers: ["R12"], label: "Reload (fresh launch)",
    async run(s, c) {
      const ok = !(await s.listNotes()).some((n) => n.id === c.id) && (await s.note(c.id!)) === null;
      return { ok, msg: ok ? "Stayed gone, tombstone impossible." : "FAIL: note came back." };
    },
  },
  {
    kind: "core", covers: ["R13"], label: "Tasks survived",
    async run(s) {
      const ok = (await s.listTasks()).length === 3;
      return { ok, msg: ok ? "Tasks survived deletion." : "Tasks wrongly removed." };
    },
  },
  {
    kind: "edge", covers: ["R14"], label: "Reject empty title",
    async run(s) {
      const before = (await s.listNotes()).length;
      const r = await s.createNote("   ", "health");
      const after = (await s.listNotes()).length;
      const ok = r === null && after === before;
      return { ok, msg: ok ? "Blank title refused." : "FAIL: blank accepted." };
    },
  },
  {
    kind: "edge", covers: ["R15"], label: "Delete the same note twice",
    async run(s) {
      const t = (await s.createNote("Temp", "brain"))!;
      await s.deleteNote(t);
      let crashed = false;
      try { await s.deleteNote(t); } catch { crashed = true; }
      const gone = !(await s.listNotes()).some((n) => n.id === t);
      const ok = !crashed && gone;
      return { ok, msg: ok ? "Second delete safe." : "FAIL: crashed or left data." };
    },
  },
  {
    kind: "edge", covers: ["R16"], label: "Tasks from an empty checklist",
    async run(s) {
      const t = (await s.createNote("EmptyCl", "money"))!;
      await s.addChecklist(t, []);
      const made = await s.tasksFromChecklist(t);
      await s.deleteNote(t);
      const ok = made.length === 0;
      return { ok, msg: ok ? "0 tasks from empty checklist." : "FAIL: tasks from nothing." };
    },
  },
  {
    kind: "edge", covers: ["R17"], label: "Offline edit then reconnect",
    async run(s) {
      const t = (await s.createNote("Sync Test", "tucci"))!;
      s.goOffline();
      await s.editTitle(t, "Sync Test Edited");
      const held = (await s.note(t))?.title === "Sync Test" && s.queueLen() === 1;
      await s.reconnect();
      const applied = (await s.note(t))?.title === "Sync Test Edited" && s.queueLen() === 0;
      await s.deleteNote(t);
      const ok = held && applied;
      return { ok, msg: ok ? "Offline edit held, applied on reconnect." : "FAIL: offline edit lost." };
    },
  },
  {
    kind: "edge", covers: ["R18"], label: "Delete missing block / remove missing connection",
    async run(s) {
      const t = (await s.createNote("NoOp", "brain"))!;
      let crashed = false;
      let a: boolean | undefined, b: boolean | undefined;
      try {
        a = await s.deleteBlock(t, "no-such-block");
        b = await s.removeConnection(t, "no-such-conn");
      } catch { crashed = true; }
      await s.deleteNote(t);
      const ok = !crashed && a === false && b === false;
      return { ok, msg: ok ? "Both missing-id ops were safe no-ops." : "FAIL: crashed or wrong result." };
    },
  },
];
