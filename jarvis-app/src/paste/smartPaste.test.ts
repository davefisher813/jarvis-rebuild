// @vitest-environment jsdom
// THE REFUSED VERSUS FAILED SPLIT (Phase 0 D11, PHASE0-DESIGN.md, 2026-10-10).
//
// The package's own sentence, "Need to follow up with Mike about summer
// roster", has no anchored opener, so the deterministic layer reads it as an
// unconfident task. Before this, a configured backend turned every unconfident
// line into a note whenever the model did not answer, for any reason: AI off
// in Settings, airplane mode, a non 2xx, an unparseable reply alike. Behind
// memory_v1 only the last of those makes the note; the rest leave the task
// standing. Flag off, today's branch byte for byte.
//
// 2026-10-27 (Dave): NO LINE ATTACHES A PERSON ON ITS OWN. "Text Josh Rudd"
// was filed under the contact "Josh (Bucknell)" because the first word
// matched. A name in the words is at most OFFERED (the whole name, as
// personChoices); the person is attached only by a tap.

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
// Phase 0.5: behind memory_v1 the follow up opener makes MIKE confident, so the
// AI paths are probed with a line no opener claims.
const UNSURE = "Mike and the summer roster";
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
// A model that drops the name, sends an id it was never offered, and files a note.
const rewrites: Ai = { available: true, complete: async () => JSON.stringify({ kind: "task", title: "Summer Roster", personId: "not-a-contact" }) };
const notes_: Ai = { available: true, complete: async () => JSON.stringify({ kind: "note", title: "Summer Roster", notes: "A summary in the model's words" }) };

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

  it("offline, the unconfident Mike line stays a task, and no person is filed from the first name", async () => {
    const { deps, tasks } = rig(offline);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task" });
    expect(s!.personId).toBeUndefined();
    expect(s!.personChoices).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    const t = await tasks.task(s!.id);
    expect(t?.personId).toBeUndefined();
    expect(t?.source).toEqual({ type: "paste", ts: t!.source!.ts });
  });

  it("Text Josh Rudd is not filed under Josh (Bucknell), and is not even offered him", async () => {
    const { deps, tasks } = rig(aiOff);
    const withJosh = { ...deps, people: [{ id: "josh-b", name: "Josh (Bucknell)" }] } as PasteDeps;
    const [s] = await smartPasteSave("Text Josh Rudd", withJosh);
    expect(s!.kind).toBe("task");
    expect(s!.personId).toBeUndefined();
    expect(s!.personChoices).toBeUndefined();
    expect((await tasks.task(s!.id))?.personId).toBeUndefined();
  });

  it("a contact's whole name is offered, never filed", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave("Text Mike Rossi about the roster", deps);
    expect(s!.kind).toBe("task");
    expect(s!.personChoices).toEqual(["mike"]);
    expect(s!.personId).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    expect((await tasks.task(s!.id))?.personId).toBeUndefined();
  });

  it("AI off, the same", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s).toMatchObject({ kind: "task" });
    expect(s!.personId).toBeUndefined();
    expect((await tasks.task(s!.id))?.source?.inferred).toBeUndefined();
  });

  it("a gate refusal and a non 2xx answer are refusals too", async () => {
    for (const ai of [gated, non2xx]) {
      const { deps } = rig(ai);
      const [s] = await smartPasteSave(MIKE, deps);
      expect(s).toMatchObject({ kind: "task" });
      expect(s!.personId).toBeUndefined();
    }
  });

  it("a 2xx answer that cannot be read still makes the honest note, with no person on it", async () => {
    const { deps, notes } = rig(unreadable);
    const [s] = await smartPasteSave(UNSURE, deps);
    expect(s).toMatchObject({ kind: "note" });
    expect(s!.personId).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    const n = await notes.note(s!.id);
    expect(n?.connections).toEqual([]);
    expect(await notes.notesLinkedTo("mike")).toHaveLength(0);
  });

  it("an answer that is not a string is unreadable: the honest note, never a throw out of the save", async () => {
    const { deps, notes } = rig(notAString);
    const [s] = await smartPasteSave(UNSURE, deps);
    expect(s!.kind).toBe("note");
    expect(s!.personId).toBeUndefined();
    expect(await notes.note(s!.id)).toBeTruthy();
  });

  it("the model's reading lands its words, and a person id it sends never lands", async () => {
    const { deps, tasks } = rig(reads);
    const [s] = await smartPasteSave(UNSURE, deps);
    expect(s).toMatchObject({ kind: "task", title: "Follow Up with Mike" });
    expect(s!.personId).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    const t = await tasks.task(s!.id);
    expect(t?.personId).toBeUndefined();
    expect(t?.source?.inferred).toBeUndefined();
  });

  it("a model id it was never offered is dropped, and a title that lost words keeps the line in Notes", async () => {
    const { deps, tasks } = rig(rewrites);
    const [s] = await smartPasteSave(UNSURE, deps);
    const t = await tasks.task(s!.id);
    expect(t).toMatchObject({ text: "Summer Roster", notes: UNSURE });
    expect(t?.personId).toBeUndefined();
  });

  it("a model note keeps the line as typed, not the model's words", async () => {
    const { deps, notes } = rig(notes_);
    const [s] = await smartPasteSave(UNSURE, deps);
    expect(s).toMatchObject({ kind: "note" });
    expect(s!.personId).toBeUndefined();
    expect(JSON.stringify((await notes.note(s!.id))?.blocks)).toContain(UNSURE);
  });

  it("the package sentence is a confident task now: the model is never asked", async () => {
    let asked = 0;
    const counting: Ai = { available: true, complete: async () => { asked++; return "{}"; } };
    const { deps, tasks } = rig(counting);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(asked).toBe(0);
    expect(s).toMatchObject({ kind: "task", title: "Need to Follow Up with Mike About Summer Roster" });
    expect(s!.personId).toBeUndefined();
    expect(s!.inferred).toBeUndefined();
    expect((await tasks.task(s!.id))?.personId).toBeUndefined();
  });

  it("a line that guessed nothing carries no inferred list at all", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave("call the plumber back", deps);
    expect(s!.inferred).toBeUndefined();
    const t = await tasks.task(s!.id);
    expect(t?.source).toEqual({ type: "paste", ts: t!.source!.ts });
  });

  it("a refile keeps a person the PERSON chose: a connection on a note, personId on a task", async () => {
    const { deps, notes, tasks } = rig(aiOff);
    const [made] = await smartPasteSave(MIKE, deps);
    await tasks.setPerson(made!.id, "mike");
    const s = { ...made!, personId: "mike" };
    const next = await refileSaved(s, "note", deps);
    expect(next).toMatchObject({ kind: "note", personId: "mike" });
    const n = await notes.note(next!.id);
    expect(n?.connections).toEqual([expect.objectContaining({ kind: "person", targetId: "mike" })]);
    const back = await refileSaved(next!, "task", deps);
    expect(back).toMatchObject({ kind: "task", personId: "mike" });
    expect((await tasks.task(back!.id))?.personId).toBe("mike");
  });

  it("a refile to an event drops the person, which an event cannot hold", async () => {
    const { deps } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    const next = await refileSaved(s!, "event", deps);
    expect(next!.personId).toBeUndefined();
    expect(next!.inferred).toBeUndefined();
  });
});

describe("memory_v1 on: the follow up opener claims a short line, never copied prose", () => {
  beforeEach(() => { flags.memoryOn = true; });
  const PROSE = "Thanks for the update. I'll reach out with the numbers once I hear back. Let me know if anything changes.";

  it("a pasted message that says reach out with stays the verbatim note it was", async () => {
    const { deps, notes } = rig(aiOff);
    const [s] = await smartPasteSave(PROSE, deps);
    expect(s!.kind).toBe("note");
    expect(JSON.stringify((await notes.note(s!.id))?.blocks)).toContain(PROSE);
  });

  it("a line with a link stays a note", async () => {
    const { deps } = rig(aiOff);
    const [s] = await smartPasteSave("Roster is at https://example.com, circle back with Mike", deps);
    expect(s!.kind).toBe("note");
  });

  it("a question is not claimed: it goes to the model like any unconfident line", async () => {
    let asked = 0;
    const counting: Ai = { available: true, complete: async () => { asked++; return "not json"; } };
    const { deps } = rig(counting);
    await smartPasteSave("Did you follow up with Mike?", deps);
    expect(asked).toBe(1);
  });

  it("follow-up and followup are the same opener, and the model is never asked", async () => {
    let asked = 0;
    const counting: Ai = { available: true, complete: async () => { asked++; return "{}"; } };
    const { deps } = rig(counting);
    const saved = await smartPasteSave("Need to follow-up with Mike about summer roster\nfollowup with Mike re jerseys", deps);
    expect(asked).toBe(0);
    expect(saved.map((s) => [s.kind, s.personId])).toEqual([["task", undefined], ["task", undefined]]);
  });

  it("a refile to a note whose person is no longer in the list carries no person and claims no guess", async () => {
    const { deps, notes, tasks } = rig(aiOff);
    const [made] = await smartPasteSave(MIKE, deps);
    await tasks.setPerson(made!.id, "mike");
    const s = { ...made!, personId: "mike" };
    const next = await refileSaved(s, "note", { ...deps, people: [] } as PasteDeps);
    expect(next!.personId).toBeUndefined();
    expect(next!.inferred).toBeUndefined();
    expect((await notes.note(next!.id))?.connections).toEqual([]);
  });

  // Review fix: the opener is his own to-do, never a line about what someone
  // else will do. Those stay unconfident: AI on, the model reads them as it
  // did before Phase 0.5; AI off, the rule's task still stands (no person).
  it("someone else's doing is not claimed: the model may still read it", async () => {
    let asked = 0;
    const counting: Ai = { available: true, complete: async () => { asked++; return "not json"; } };
    const { deps } = rig(counting);
    await smartPasteSave("Mike will follow up with me about the roster", deps);
    await smartPasteSave("Mike said he'd check in with the league", deps);
    expect(asked).toBe(2);
  });

  it("someone else's doing, AI off: the rule's task stands, with no person", async () => {
    const { deps, tasks } = rig(aiOff);
    const [s] = await smartPasteSave("Mike will follow up with me about the roster", deps);
    expect(s).toMatchObject({ kind: "task" });
    expect(s!.personId).toBeUndefined();
    expect((await tasks.task(s!.id))?.personId).toBeUndefined();
  });

  it("a lead in, a date word or a phone's curly apostrophe still opens it, and the model is never asked", async () => {
    let asked = 0;
    const counting: Ai = { available: true, complete: async () => { asked++; return "{}"; } };
    const { deps } = rig(counting);
    const saved = await smartPasteSave("I’ll circle back with Mike\nTomorrow follow up with Mike\nRemember to reach out with Mike about cleats", deps);
    expect(asked).toBe(0);
    expect(saved.map((s) => [s.kind, s.personId, s.date ?? null])).toEqual([
      ["task", undefined, null], ["task", undefined, "2026-08-16"], ["task", undefined, null],
    ]);
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
    expect(s).toMatchObject({ kind: "task" });
    expect(s!.personId).toBeUndefined();
    const t = await tasks.task(s!.id);
    expect(t?.source).toEqual({ type: "paste", ts: t!.source!.ts });
    expect(Object.keys(t!.source!)).toEqual(["type", "ts"]);
  });

  it("the receipt guesses no person at all", async () => {
    const { deps } = rig(aiOff);
    const [s] = await smartPasteSave(MIKE, deps);
    expect(s!.inferred).toBeUndefined();
  });
});
