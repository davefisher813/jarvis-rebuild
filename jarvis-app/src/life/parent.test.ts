import { describe, it, expect, beforeAll } from "vitest";
import { buildParentIndex, parentForTask } from "./parent";
import { setCategoryRegistry } from "../shared/categories";
import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "./types";

// THE PARENT LINE (The Row and Health, 2026-09-02): project first, then the
// category, each with its own glyph and colour. The middle step ("the goal a
// task moves") was removed on 2026-09-06; see parent.ts for why it could
// never state a fact anyone had asserted.
const task = (id: string, data: Partial<TaskItem["data"]>): TaskItem =>
  ({ id, data: { text: id, done: false, createdAt: 0, ...data } as TaskItem["data"] });

describe("parentForTask", () => {
  beforeAll(() => setCategoryRegistry([{ id: "money", name: "Money", color: "yellow" }, { id: "work", name: "Work", color: "sky" }]));
  const projects = [{ id: "p1", data: { title: "Kitchen remodel", status: "active", category: "work", goalId: "g1" } }] as unknown as Project[];
  const goals = [{ id: "g1", data: { title: "Build a six-month runway", state: "on_track", tags: ["money"] } }] as unknown as Goal[];
  const tasks = [
    task("a", { projectId: "p1", category: "work" }),
    task("b", { projectId: "p1", category: "work", done: true }),
    task("c", { category: "money" }),
    task("d", { category: "work" }),
    task("e", {}),
  ];
  // Built inside each test: the registry is set in beforeAll, and the index
  // reads colours at build time.
  const idx = () => buildParentIndex(projects, goals, tasks);

  it("a filed task wears its project, with the project's progress and category colour", () => {
    expect(parentForTask(idx(), tasks[0]!)).toEqual({ kind: "project", name: "Kitchen remodel", tone: "cat-fg-sky", pct: 50 });
  });
  // CORRECTED 2026-09-06. This case used to expect the goal, which is the
  // bug Dave reported from his phone: "unlabeled tasks randomly go into
  // projects and goals that have nothing to do with them". Task c is not
  // filed anywhere. It is simply a Money task, and the goal happens to WATCH
  // Money, so every Money task in the app wore "Build a six-month runway" as
  // its home. A tag is a saved filter over a category; it is not a link
  // anyone made, and a task carries no goalId, so this branch could never
  // once have been right. The row says where the task lives: its area.
  it("a task in an area a goal merely watches wears the area, not the goal", () => {
    expect(parentForTask(idx(), tasks[2]!)).toEqual({ kind: "category", name: "Money", tone: "cat-fg-yellow", pct: null });
  });
  // The screenshot, as a test: a goal watching a broad area must not adopt
  // unrelated work in it. Submit job apps is not apartment work.
  it("a goal that watches a broad area does not adopt the work in it", () => {
    const broad = [{ id: "g2", data: { title: "Make apartment aesthetic", state: "on_track", tags: ["work"] } }] as unknown as Goal[];
    const jobApps = task("apps", { category: "work" });
    const p = parentForTask(buildParentIndex([], broad, [jobApps]), jobApps);
    expect(p).toEqual({ kind: "category", name: "Work", tone: "cat-fg-sky", pct: null });
    expect(p!.name).not.toBe("Make apartment aesthetic");
  });
  // And the link a person DID make still wins, unchanged.
  it("filing still names the project, and through it the real chain", () => {
    expect(parentForTask(idx(), tasks[0]!)?.kind).toBe("project");
  });
  it("a task that moves nothing wears its category", () => {
    expect(parentForTask(idx(), tasks[3]!)).toEqual({ kind: "category", name: "Work", tone: "cat-fg-sky", pct: null });
  });
  it("a task with nothing at all says nothing, so the row can say No category", () => {
    expect(parentForTask(idx(), tasks[4]!)).toBeNull();
  });
});

// EVENTS ARE FIRST-CLASS (Dave, on the list since 2026-09-07: "events aren't
// first-class entities"; built 2026-09-09). A task can belong to an EVENT now,
// the way it has always been able to belong to a project, and the row says so.
describe("the event a task belongs to", () => {
  const EV = [{ id: "e1", data: { title: "Saturday Tournament", date: "2026-09-12", start: "09:00", category: "sport" } }] as never;

  it("a task filed to an event leads its line with the event", () => {
    const t = { id: "t1", data: { text: "Print the roster", category: "sport", done: false, eventId: "e1" } } as never;
    const p = parentForTask(buildParentIndex([], [], [t], EV), t)!;
    expect(p.kind).toBe("event");
    expect(p.name).toBe("Saturday Tournament");
  });

  // The event decides WHEN the task has to be done, which is the stronger
  // statement of where it lives. The project is still on the sheet.
  it("the event outranks the project when a task carries both", () => {
    const proj = { id: "p1", data: { title: "Season Ops", category: "sport" } } as never;
    const t = { id: "t1", data: { text: "Print the roster", category: "sport", done: false, eventId: "e1", projectId: "p1" } } as never;
    expect(parentForTask(buildParentIndex([proj], [], [t], EV), t)!.kind).toBe("event");
  });

  // The index is optional so this could land without touching a call site.
  // A caller with no events to hand must fall straight through to the line it
  // always drew, never to a blank one.
  it("falls through to the project when the index has no events", () => {
    const proj = { id: "p1", data: { title: "Season Ops", category: "sport" } } as never;
    const t = { id: "t1", data: { text: "Print the roster", category: "sport", done: false, eventId: "e1", projectId: "p1" } } as never;
    expect(parentForTask(buildParentIndex([proj], [], [t]), t)!.kind).toBe("project");
  });

  it("an eventId pointing at nothing is not a parent, it is no parent", () => {
    const t = { id: "t1", data: { text: "Print the roster", category: "", done: false, eventId: "gone" } } as never;
    expect(parentForTask(buildParentIndex([], [], [t], EV), t)).toBeNull();
  });
});
