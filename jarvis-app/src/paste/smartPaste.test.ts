// @vitest-environment jsdom
// THE REFUSED VERSUS FAILED SPLIT (Phase 0 D11, PHASE0-DESIGN.md, 2026-10-10).
//
// The package's own sentence, "Need to follow up with Mike about summer
// roster", has no anchored opener, so the deterministic layer reads it as an
// unconfident task with personId set. Before this, a configured backend
// turned every unconfident line into a note with no personId whenever the
// model did not answer, for any reason: AI off in Settings, airplane mode,
// a non 2xx, an unparseable reply alike. Behind memory_v1 only the last of
// those makes the note; the rest leave the task standing with Mike on it, and
// the stamp says personId was a guess. Flag off, today's branch byte for byte.

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { smartPasteSave, refileSaved, type PasteDeps } from "./smartPaste";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import type { AIService } from "../ai/AIService";
import type { AIContext } from "../ai/context";

// The flag seam every flagged test uses (connections/google/sync.test.ts):
// one switch, every other flag answers as the build does.
const flags = vi.hoisted(() => ({ memoryOn: false }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "memory_v1" ? flags.memoryOn : real.flagOn(f)) };
});

const TODAY = "2026-08-15";
const U = "user1";
const MIKE = "Need to follow up with Mike about summer roster";
const people = [{ id: "mike", name: "Mike Rossi" }];

type Ai = Pick<AIService, "available" | "complete">;
const offline: Ai = { available: true, complete: async () => { throw new TypeError("Failed to fetch"); } };
const aiOff: Ai = { available: false, complete: async () => { throw new Error("AI is not configured in this build."); } };
const gated: Ai = { available: true, complete: async () => { throw new Error("AI is off"); } };
const non2xx: Ai = { available: true, complete: async () => { throw new Error("AI request failed (502)."); } };
const unreadable: Ai = { available: true, complete: async () => "not json" };
// A double that resolves to something that is not a string (AIService.complete is typed string; the parse must not throw).
const notAString: Ai = { available: true, complete: (async () => undefined) as unknown as Ai["complete"] };
const reads: Ai = { available: true, complete: async () => JSON.stringify({ kind: "task", title: "Follow Up with Mike", personId: "mike" }) };

function rig(ai: Ai) {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, U);
  const notes = new NotesService(store, U);
  const deps = {
    ai: ai as AIService,
    gather: async () => ({ categories: [] }) as unknown as AIContext,
    tasks,
    schedule: new ScheduleService(store, U),
    notes,
    categories: [],
    today: TODAY,
    people,
  } as unknown as PasteDeps;
  return { deps, tasks, notes };
}

beforeEach(() => { localStorage.clear(); flags.memoryOn = false; });

describe("memory_v1 on: refused leaves the deterministic reading standing", () => {
  beforeEach(() => { flags.memoryOn = true; });

  it("offline, the unconfident Mike line stays a task with personId, and the stamp says personId was guessed", async () => {
    const { deps, tasks } = rig(offline);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task", personId: "mike", inferred: ["personId"] });
    const t = await tasks.task(s!.id);
    expect(t?.personId).toBe("mike");
    expect(t?.source).toMatchObject({ type: "paste", inferred: ["personId"] });
  });

  it("AI off, the same", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task", personId: "mike" });
    expect((await tasks.task(s!.id))?.source?.inferred).toEqual(["personId"]);
  });

  it("a gate refusal and a non 2xx answer are refusals too", async () => {
    for (const ai of [gated, non2xx]) {
      const { deps } = rig(ai);
      const [s] = await smartPasteSave(MIKE, deps);
      expect(s).toMatchObject({ kind: "task", personId: "mike" });
    }
  });

  it("a 2xx answer that cannot be read still makes the honest note, with no guess on it", async () => {
    const { deps, notes } = rig(unreadable);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.kind).toBe("note");
    expect(s!.personId).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    const n = await notes.note(s!.id);
    expect(n?.source).toEqual({ type: "paste", ts: n!.source!.ts });
  });

  it("an answer that is not a string is unreadable: the honest note, never a throw out of the save", async () => {
    const { deps, notes } = rig(notAString);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.kind).toBe("note");
    expect(s!.personId).toBeUndefined();
    expect(await notes.note(s!.id)).toBeTruthy();
  });

  it("the model's own reading is the model's: nothing on it is stamped as the rule's guess", async () => {
    const { deps, tasks } = rig(reads);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task", title: "Follow Up with Mike" });
    expect((await tasks.task(s!.id))?.source?.inferred).toBeUndefined();
  });

  it("a line that guessed nothing carries no inferred list at all", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave("call the plumber back", deps);
    expect(s!.inferred).toBeUndefined();
    const t = await tasks.task(s!.id);
    expect(t?.source).toEqual({ type: "paste", ts: t!.source!.ts });
  });

  it("a refile keeps only the guesses the copy still carries", async () => {
    const { deps, notes } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    const next = await refileSaved(s!, "note", deps);
    expect(next!.kind).toBe("note");
    expect(next!.inferred).toBeUndefined();
    expect((await notes.note(next!.id))?.source?.inferred).toBeUndefined();
  });
});

describe("memory_v1 off: today's branch, byte for byte", () => {
  it("offline, the Mike line is a note with no personId, stamped madeBy(paste) alone", async () => {
    const { deps, notes } = rig(offline);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.kind).toBe("note");
    expect(s!.personId).toBeUndefined();
    const n = await notes.note(s!.id);
    expect(n?.source).toEqual({ type: "paste", ts: n!.source!.ts });
  });

  it("an answer that is not a string is today's note too, stamped madeBy(paste) alone", async () => {
    const { deps, notes } = rig(notAString);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.kind).toBe("note");
    expect(s!.personId).toBeUndefined();
    const n = await notes.note(s!.id);
    expect(n?.source).toEqual({ type: "paste", ts: n!.source!.ts });
  });

  it("AI off, the deterministic task stands as before, and the stamp carries no inferred field", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task", personId: "mike" });
    const t = await tasks.task(s!.id);
    expect(t?.source).toEqual({ type: "paste", ts: t!.source!.ts });
    expect(Object.keys(t!.source!)).toEqual(["type", "ts"]);
  });

  it("the receipt still knows what was guessed, even while the stamp does not say", async () => {
    const { deps } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.inferred).toEqual(["personId"]);
  });
});
