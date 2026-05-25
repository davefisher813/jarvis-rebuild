import type { TasksService, TaskItem } from "./TasksService";
import type { NotesService } from "../notes/NotesService";
import { groupFor, urgencyFor } from "./grouping";

// SINGLE SOURCE (real-code side): the behaviors approved in the Tasks harness,
// mirrored against the real TasksService (+ NotesService for the from-note
// step). Same behaviors, same assertions; async because the services are async.
// tasks.test.ts runs these in order on one shared store. "Today" is fixed so the
// grouping assertions are repeatable.

export const TODAY = "2026-05-23";

const DAY = 86400000;
export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + "T00:00:00").getTime() + n * DAY).toISOString().slice(0, 10);
}

export interface Ctx {
  ids: Record<string, string>;
  noteId?: string;
}
export interface StepResult {
  ok: boolean;
  msg: string;
}
export interface Step {
  kind: "core" | "edge";
  covers: string[];
  label: string;
  run(t: TasksService, n: NotesService, c: Ctx): Promise<StepResult>;
}

export interface Requirement {
  id: string;
  text: string;
}
export const REQUIREMENTS: Requirement[] = [
  { id: "T1", text: "Create a task with a category and optional due date" },
  { id: "T2", text: "Group tasks into Today / Upcoming / Done by due date" },
  { id: "T3", text: "Today holds tasks due today and overdue tasks" },
  { id: "T4", text: "Urgency tag: OVERDUE (red), TODAY (blue), weekday/date (muted), or none" },
  { id: "T5", text: "Complete and un-complete a task (moves between Done and its group)" },
  { id: "T6", text: "Edit a task's text" },
  { id: "T7", text: "Change a task's due date (re-groups it)" },
  { id: "T8", text: "Tasks created from a note checklist appear here, linked and categorized" },
  { id: "T9", text: "Delete a task" },
  { id: "T10", text: "Reject an empty task" },
  { id: "T11", text: "Offline changes queue and sync on reconnect" },
  { id: "T12", text: "Group counts reflect the current list" },
];

async function find(t: TasksService, text: string): Promise<TaskItem | undefined> {
  const all = await t.listTasks();
  return all.find((x) => x.data.text === text);
}
const ok = (msg: string): StepResult => ({ ok: true, msg });
const fail = (msg: string): StepResult => ({ ok: false, msg });

export const STEPS: Step[] = [
  {
    kind: "edge",
    covers: ["T2"],
    label: "Empty state: no tasks in any group",
    async run(t) {
      const g = await t.grouped(TODAY);
      return g.today.length + g.upcoming.length + g.done.length === 0
        ? ok("no tasks")
        : fail("expected no tasks");
    },
  },
  {
    kind: "core",
    covers: ["T1", "T2", "T4"],
    label: "Create a task due today, lands in Today with a TODAY tag",
    async run(t, _n, c) {
      const id = await t.createTask("Submit invoice", { category: "money", due: TODAY });
      if (!id) return fail("not created");
      c.ids["Submit invoice"] = id;
      const item = await find(t, "Submit invoice");
      if (!item) return fail("not found");
      const u = urgencyFor(item.data, TODAY);
      return groupFor(item.data, TODAY) === "today" && u?.label === "TODAY"
        ? ok("Today + TODAY tag")
        : fail("wrong group/tag");
    },
  },
  {
    kind: "core",
    covers: ["T1", "T2"],
    label: "Create a task due in 3 days, lands in Upcoming",
    async run(t, _n, c) {
      const id = await t.createTask("Book flights", { category: "family", due: addDays(TODAY, 3) });
      c.ids["Book flights"] = id!;
      const item = await find(t, "Book flights");
      return item && groupFor(item.data, TODAY) === "upcoming" ? ok("Upcoming") : fail("not Upcoming");
    },
  },
  {
    kind: "core",
    covers: ["T3", "T4"],
    label: "Create an overdue task, lands in Today with a red OVERDUE tag",
    async run(t, _n, c) {
      const id = await t.createTask("File taxes", { category: "money", due: addDays(TODAY, -1) });
      c.ids["File taxes"] = id!;
      const item = await find(t, "File taxes");
      const u = item && urgencyFor(item.data, TODAY);
      return item && groupFor(item.data, TODAY) === "today" && u?.kind === "overdue"
        ? ok("Today + OVERDUE")
        : fail("not flagged overdue");
    },
  },
  {
    kind: "core",
    covers: ["T1", "T2", "T4"],
    label: "Create a task with no due date, lands in Upcoming with no tag",
    async run(t, _n, c) {
      const id = await t.createTask("Read Ulysses", { category: "brain" });
      c.ids["Read Ulysses"] = id!;
      const item = await find(t, "Read Ulysses");
      return item && groupFor(item.data, TODAY) === "upcoming" && urgencyFor(item.data, TODAY) === null
        ? ok("Upcoming, no tag")
        : fail("unexpected group/tag");
    },
  },
  {
    kind: "core",
    covers: ["T5"],
    label: "Complete a task, moves to Done",
    async run(t, _n, c) {
      await t.toggleDone(c.ids["Submit invoice"]!);
      const item = await find(t, "Submit invoice");
      return item && item.data.done && groupFor(item.data, TODAY) === "done"
        ? ok("in Done")
        : fail("did not move to Done");
    },
  },
  {
    kind: "core",
    covers: ["T5"],
    label: "Un-complete a task, returns to Today",
    async run(t, _n, c) {
      await t.toggleDone(c.ids["Submit invoice"]!);
      const item = await find(t, "Submit invoice");
      return item && !item.data.done && groupFor(item.data, TODAY) === "today"
        ? ok("back in Today")
        : fail("did not return to Today");
    },
  },
  {
    kind: "core",
    covers: ["T6"],
    label: "Edit a task's text",
    async run(t, _n, c) {
      await t.editText(c.ids["Book flights"]!, "Book flights to NYC");
      return (await find(t, "Book flights to NYC")) ? ok("text updated") : fail("text not updated");
    },
  },
  {
    kind: "core",
    covers: ["T7"],
    label: "Change a due date, re-groups Upcoming to Today",
    async run(t, _n, c) {
      await t.setDue(c.ids["Read Ulysses"]!, TODAY);
      const item = await find(t, "Read Ulysses");
      return item && groupFor(item.data, TODAY) === "today" ? ok("moved to Today") : fail("did not re-group");
    },
  },
  {
    kind: "core",
    covers: ["T8"],
    label: "Create tasks from a note checklist, linked and categorized",
    async run(t, n, c) {
      const noteId = await n.createNote("Quarter close", "money");
      c.noteId = noteId!;
      await n.addChecklist(noteId!, ["Email accountant", "Gather receipts"]);
      await n.tasksFromChecklist(noteId!);
      const all = await t.listTasks();
      const linked = all.filter((x) => x.data.fromNote === noteId);
      return linked.length === 2 && linked.every((x) => x.data.category === "money")
        ? ok("2 linked money tasks")
        : fail("expected 2 linked tasks");
    },
  },
  {
    kind: "core",
    covers: ["T9"],
    label: "Delete a task",
    async run(t, _n, c) {
      await t.deleteTask(c.ids["File taxes"]!);
      return (await find(t, "File taxes")) ? fail("still present") : ok("removed");
    },
  },
  {
    kind: "edge",
    covers: ["T10"],
    label: "Reject an empty task",
    async run(t) {
      const before = (await t.listTasks()).length;
      const id = await t.createTask("   ");
      const after = (await t.listTasks()).length;
      return id === null && before === after ? ok("empty rejected") : fail("empty task created");
    },
  },
  {
    kind: "edge",
    covers: ["T11"],
    label: "Offline change queues, then syncs on reconnect",
    async run(t, _n, c) {
      t.goOffline();
      await t.toggleDone(c.ids["Read Ulysses"]!);
      if (t.queueLen() !== 1) return fail(`expected 1 queued, got ${t.queueLen()}`);
      await t.reconnect();
      const item = await find(t, "Read Ulysses");
      return t.queueLen() === 0 && item?.data.done === true
        ? ok("queued then applied")
        : fail("did not sync on reconnect");
    },
  },
  {
    kind: "core",
    covers: ["T12"],
    label: "Group counts reflect the current list",
    async run(t) {
      const g = await t.grouped(TODAY);
      return g.today.length === 1 && g.upcoming.length === 3 && g.done.length === 1
        ? ok(`Today ${g.today.length}, Upcoming ${g.upcoming.length}, Done ${g.done.length}`)
        : fail(`got Today ${g.today.length}, Upcoming ${g.upcoming.length}, Done ${g.done.length}`);
    },
  },
];
