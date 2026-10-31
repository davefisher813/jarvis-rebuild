// @vitest-environment jsdom
// ASK, DON'T GUESS (the speech box, 2026-10-31; research: "when the app is torn between two types, the draft asks with two
// big buttons instead of guessing. That is the direct cure for events filed as notes.")
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { smartPasteSave, type PasteDeps } from "./smartPaste";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import type { AIService } from "../ai/AIService";
import type { AIContext } from "../ai/context";

const TODAY = "2026-10-31";
const U = "user1";
const LINE = "Marco and the summer roster";
type Ai = Pick<AIService, "available" | "complete">;
const answer = (o: Record<string, unknown>): Ai => ({ available: true, complete: async () => JSON.stringify(o) });

function rig(ai: Ai, askKind?: PasteDeps["askKind"]) {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, U);
  const notes = new NotesService(store, U);
  const schedule = new ScheduleService(store, U);
  const deps = {
    ai: ai as AIService, gather: async () => ({ categories: [] }) as unknown as AIContext,
    tasks, schedule, notes, categories: [], today: TODAY, ...(askKind ? { askKind } : {}),
  } as unknown as PasteDeps;
  return { deps, tasks, notes, schedule };
}

beforeEach(() => { localStorage.clear(); });

describe("a close call is asked, not guessed", () => {
  it("a low-confidence answer asks with both kinds, and his pick is what is saved", async () => {
    const ask = vi.fn(async () => "task" as const);
    const { deps, tasks, notes } = rig(answer({ kind: "note", title: "Summer Roster", confidence: "low", alternative: "task" }), ask);
    const [s] = await smartPasteSave(LINE, deps);
    expect(ask).toHaveBeenCalledWith(LINE, ["note", "task"]);
    expect(s!.kind).toBe("task");
    expect(await tasks.listTasks()).toHaveLength(1);
    expect(await notes.listNotes()).toHaveLength(0);
  });

  it("backing out saves nothing", async () => {
    const { deps, tasks, notes } = rig(answer({ kind: "note", title: "Summer Roster", confidence: "low", alternative: "task" }), async () => null);
    expect(await smartPasteSave(LINE, deps)).toHaveLength(0);
    expect(await tasks.listTasks()).toHaveLength(0);
    expect(await notes.listNotes()).toHaveLength(0);
  });

  it("an event is never offered without a day and a time: that would be a guessed schedule", async () => {
    const ask = vi.fn(async () => "note" as const);
    const { deps } = rig(answer({ kind: "event", title: "Summer Roster", confidence: "low", alternative: "note" }), ask);
    await smartPasteSave(LINE, deps);
    expect(ask).toHaveBeenCalledWith(LINE, ["task", "note"]);
  });

  it("a sure answer is not asked about", async () => {
    const ask = vi.fn(async () => "task" as const);
    const { deps } = rig(answer({ kind: "note", title: "Summer Roster", confidence: "high" }), ask);
    const [s] = await smartPasteSave(LINE, deps);
    expect(ask).not.toHaveBeenCalled();
    expect(s!.kind).toBe("note");
  });

  it("an answer the app cannot read is asked as Task or Note, never filed as a Note by default", async () => {
    const ask = vi.fn(async () => "task" as const);
    const { deps, tasks, notes } = rig({ available: true, complete: async () => "not json" }, ask);
    const [s] = await smartPasteSave(LINE, deps);
    expect(ask).toHaveBeenCalledWith(LINE, ["task", "note"]);
    expect(s!.kind).toBe("task");
    expect(await tasks.listTasks()).toHaveLength(1);
    expect(await notes.listNotes()).toHaveLength(0);
  });

  it("without the hook (a surface that cannot ask), the model's first choice stands, as before", async () => {
    const { deps } = rig(answer({ kind: "note", title: "Summer Roster", confidence: "low", alternative: "task" }));
    const [s] = await smartPasteSave(LINE, deps);
    expect(s!.kind).toBe("note");
  });
});
