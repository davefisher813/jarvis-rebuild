// @vitest-environment jsdom
// Smart Paste laws (addendum item 1): deterministic BEFORE any AI call,
// instant reversible saves with paste provenance, honest note fallback,
// resolved dates, Title Case on created titles with copied text never
// rewritten, unambiguous multi-entity split, and the exact-text 7-day dedupe.

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { titleCase, resolveDay, resolveTime, classifyLine, parsePaste } from "./deterministic";
import { pasteSeenAge, markPasteSeen, readRecentCaptures } from "./captureLog";
import { smartPasteSave, undoSaved, refileSaved, type PasteDeps } from "./smartPaste";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import type { AIService } from "../ai/AIService";
import type { AIContext } from "../ai/context";

const TODAY = "2026-08-15"; // a Saturday
const U = "user1";

function rig(aiCalls: { n: number }, available = true): PasteDeps {
  const store = new Store(new InMemoryAdapter());
  const fakeAI = {
    available,
    complete: async () => { aiCalls.n++; return "not json"; },
  } as unknown as AIService;
  return {
    ai: fakeAI,
    // Gathering context costs reads; the confident path must never do it.
    gather: async () => { throw new Error("no context in tests"); },
    tasks: new TasksService(store, U),
    schedule: new ScheduleService(store, U),
    notes: new NotesService(store, U),
    categories: [],
    today: TODAY,
  } as unknown as PasteDeps;
}

beforeEach(() => localStorage.clear());

describe("deterministic parsing", () => {
  it("Title Case follows the convention: small words lowercase, edges capped, existing caps kept", () => {
    // "with" is a small word: lowercase mid-title, per the convention. (The
    // approval preview PNG over-capped it; the convention wins, per the
    // spec-changed-or-app-wrong discipline.)
    expect(titleCase("dinner with marco")).toBe("Dinner with Marco");
    expect(titleCase("add to schedule the thing")).toBe("Add to Schedule the Thing");
    expect(titleCase("flight AA1187 to boston")).toBe("Flight AA1187 to Boston");
    expect(titleCase("apply to")).toBe("Apply To");
  });

  it("resolves relative days against today", () => {
    expect(resolveDay("tomorrow", TODAY)).toBe("2026-08-16");
    expect(resolveDay("thursday", TODAY)).toBe("2026-08-20");
    expect(resolveDay("aug 20", TODAY)).toBe("2026-08-20");
    expect(resolveDay("8/20", TODAY)).toBe("2026-08-20");
    expect(resolveDay("no date here", TODAY)).toBeNull();
  });

  it("resolves times", () => {
    expect(resolveTime("7pm")).toBe("19:00");
    expect(resolveTime("7:30 am")).toBe("07:30");
    expect(resolveTime("noon")).toBe("12:00");
    expect(resolveTime("14:45")).toBe("14:45");
    expect(resolveTime("no time")).toBeNull();
  });

  it("a day plus a time is a confident event with a clean title", () => {
    const e = classifyLine("dinner with marco thursday 7pm", TODAY);
    expect(e).toMatchObject({ kind: "event", date: "2026-08-20", start: "19:00", confident: true });
    expect(e.title).toBe("Dinner with Marco");
  });

  it("an imperative line is a confident task", () => {
    const e = classifyLine("call the plumber back", TODAY);
    expect(e).toMatchObject({ kind: "task", confident: true });
    expect(e.title).toBe("Call the Plumber Back");
  });

  it("long prose is a note and the body is the paste VERBATIM", () => {
    const prose = "The meeting covered three things. First the budget, which is fine. Second the schedule, which is not. https://example.com/notes has the deck.";
    const e = classifyLine(prose, TODAY);
    expect(e.kind).toBe("note");
    expect(e.body).toBe(prose);
    expect(e.confident).toBe(true);
  });

  it("multi-entity split happens only on multiple lines, each read alone", () => {
    const out = parsePaste("call the plumber back\ndinner with marco thursday 7pm", TODAY);
    expect(out.entities.length).toBe(2);
    expect(out.entities[0]!.kind).toBe("task");
    expect(out.entities[1]!.kind).toBe("event");
    expect(out.confident).toBe(true);
  });

  it("a mostly-prose paste collapses to ONE note, not a dozen", () => {
    const text = Array.from({ length: 5 }, (_, i) => `This is sentence group ${i}. It rambles on for a while, well past any task shape. It keeps going to be sure.`).join("\n");
    const out = parsePaste(text, TODAY);
    expect(out.entities.length).toBe(1);
    expect(out.entities[0]!.kind).toBe("note");
    expect(out.entities[0]!.body).toBe(text.trim());
  });
});

describe("law: deterministic runs BEFORE any AI call", () => {
  it("a confident paste makes ZERO AI calls", async () => {
    const calls = { n: 0 };
    const deps = rig(calls);
    const saved = await smartPasteSave("dinner with marco thursday 7pm", deps);
    expect(saved.length).toBe(1);
    expect(calls.n).toBe(0);
  });

  it("an unconfident line falls back to an honest note when the AI cannot help", async () => {
    const calls = { n: 0 };
    const deps = rig(calls);
    // Ambiguous: not imperative, no date, short. gather throws in the rig,
    // so the AI path fails and the fallback must be a NOTE, never a guessed
    // schedule.
    const saved = await smartPasteSave("thing for the thing maybe", deps);
    expect(saved.length).toBe(1);
    expect(saved[0]!.kind).toBe("note");
  });

  it("without AI in the build, the deterministic guess stands as a task", async () => {
    const calls = { n: 0 };
    const deps = rig(calls, false);
    const saved = await smartPasteSave("thing for the thing maybe", deps);
    expect(saved[0]!.kind).toBe("task");
    expect(calls.n).toBe(0);
  });
});

describe("instant save, provenance, undo, refile", () => {
  it("a saved task carries paste provenance", async () => {
    const deps = rig({ n: 0 });
    const saved = await smartPasteSave("call the plumber back", deps);
    const t = await deps.tasks.task(saved[0]!.id);
    expect(t!.source?.type).toBe("paste");
  });

  it("undo removes the record entirely", async () => {
    const deps = rig({ n: 0 });
    const saved = await smartPasteSave("call the plumber back", deps);
    await undoSaved(saved[0]!, deps);
    expect(await deps.tasks.task(saved[0]!.id)).toBeNull();
  });

  it("refile task -> event recreates with the same facts and provenance", async () => {
    const deps = rig({ n: 0 });
    const saved = await smartPasteSave("call the plumber back", deps);
    const next = await refileSaved(saved[0]!, "event", deps);
    expect(next!.kind).toBe("event");
    expect(await deps.tasks.task(saved[0]!.id)).toBeNull();
    const events = await deps.schedule.listEvents();
    expect(events.length).toBe(1);
    expect(events[0]!.data.source?.type).toBe("paste");
  });

  it("saves land on the Recent Captures strip, capped at 10", async () => {
    const deps = rig({ n: 0 });
    for (let i = 0; i < 12; i++) await smartPasteSave(`call person number ${i}`, deps);
    const recents = readRecentCaptures();
    expect(recents.length).toBe(10);
    expect(recents[0]!.title).toContain("11");
  });
});

describe("exact-text 7-day dedupe", () => {
  it("the same exact text within 7 days is flagged with its age", () => {
    const now = { t: 1_000_000_000_000 };
    const clock = () => now.t;
    markPasteSeen("buy milk", clock);
    now.t += 2 * 86400000;
    expect(pasteSeenAge("buy milk", clock)).toBe(2 * 86400000);
    expect(pasteSeenAge("buy milk!", clock)).toBeNull();
  });

  it("after 7 days the same text is fresh again", () => {
    const now = { t: 1_000_000_000_000 };
    const clock = () => now.t;
    markPasteSeen("buy milk", clock);
    now.t += 8 * 86400000;
    expect(pasteSeenAge("buy milk", clock)).toBeNull();
  });
});
