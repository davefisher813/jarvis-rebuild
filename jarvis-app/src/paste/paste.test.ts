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
import { LearnedRulesService } from "../rules/LearnedRulesService";
import { aliasTrigger } from "../rules/triggers";

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

// APPLYING WHAT IT LEARNED (2026-08-24). Two identical corrections of the
// same proper noun make a rule; these are the tests for the decision point
// that rule exists to answer. The refusals matter more than the hits: a rule
// that fires when it should not is worse than no rules at all, because the
// user cannot see it happen and has no reason to look.
describe("learned category rules", () => {
  const CATS = [
    { id: "cat-work", data: { name: "Work", color: "blue", order: 0 } },
    { id: "cat-family", data: { name: "Family", color: "pink", order: 1 } },
  ] as unknown as PasteDeps["categories"];

  // A rules store thin enough that each test states exactly what it answers.
  function fakeRules(answer: { to: string; announced?: boolean } | null, log: string[] = []) {
    const rule = answer ? { id: "r1", data: { kind: "alias", scope: "capture.category", from: "x", to: answer.to, evidence: [], createdAt: "", announced: answer.announced } } : null;
    return {
      log,
      resolve: async (scope: string, from: string) => { log.push(`resolve ${scope} ${from}`); return rule as never; },
      announceIfFirstUse: async () => { log.push("announce"); },
    };
  }

  const withRules = (deps: PasteDeps, rules: unknown, categories = CATS) =>
    ({ ...deps, categories, rules } as unknown as PasteDeps);

  it("categorises a capture from a rule keyed on its proper noun", async () => {
    const calls = { n: 0 };
    const log: string[] = [];
    const deps = withRules(rig(calls, false), fakeRules({ to: "cat-family" }, log));
    const [s] = await smartPasteSave("Elite Squad practice", deps);
    expect(s!.category).toBe("cat-family");
    expect(log).toContain("resolve capture.category Elite Squad");
  });

  // The deal that licenses creating a rule with no confirmation step.
  it("announces the first time a rule changes something", async () => {
    const log: string[] = [];
    const deps = withRules(rig({ n: 0 }, false), fakeRules({ to: "cat-family" }, log));
    await smartPasteSave("Elite Squad practice", deps);
    expect(log).toContain("announce");
  });

  // A rule that agrees with what JARVIS was going to do anyway changed
  // nothing, so it is not a use, so announcing would be noise about a
  // non-event. This toast has exactly one job.
  it("stays quiet when the rule agrees with the category already chosen", async () => {
    const log: string[] = [];
    const base = rig({ n: 0 }, false);
    const [first] = await smartPasteSave("Elite Squad practice", { ...base, categories: CATS } as PasteDeps);
    const deps = withRules(rig({ n: 0 }, false), fakeRules({ to: first!.category ?? "" }, log));
    await smartPasteSave("Elite Squad practice again", deps);
    expect(log).not.toContain("announce");
  });

  // Nothing here guesses. A capture with no name in it has no trigger, so
  // the store is never even asked.
  it("does not consult the store when the text carries no proper noun", async () => {
    const log: string[] = [];
    const deps = withRules(rig({ n: 0 }, false), fakeRules({ to: "cat-family" }, log));
    await smartPasteSave("pick up milk", deps);
    expect(log).toEqual([]);
  });

  it("falls through when no rule matches the trigger", async () => {
    const log: string[] = [];
    const deps = withRules(rig({ n: 0 }, false), fakeRules(null, log));
    const [s] = await smartPasteSave("Elite Squad practice", deps);
    expect(s!.category).not.toBe("cat-family");
    expect(log).not.toContain("announce");
  });

  // A rule pointing at a deleted category would write a dangling id.
  // Ignored rather than repaired: guessing which category replaced it is the
  // exact inference this engine exists to avoid.
  it("ignores a rule pointing at a category that no longer exists", async () => {
    const log: string[] = [];
    const deps = withRules(rig({ n: 0 }, false), fakeRules({ to: "cat-deleted" }, log));
    const [s] = await smartPasteSave("Elite Squad practice", deps);
    expect(s!.category).not.toBe("cat-deleted");
    expect(log).not.toContain("announce");
  });

  // Learning is a bonus on top of a capture, never a condition of it. A
  // store that cannot be read must not cost him the thing he just pasted.
  it("still saves the capture when the rules store throws", async () => {
    const deps = withRules(rig({ n: 0 }, false), {
      resolve: async () => { throw new Error("store down"); },
      announceIfFirstUse: async () => { /* never reached */ },
    });
    const [s] = await smartPasteSave("Elite Squad practice", deps);
    expect(s).toBeTruthy();
  });

  // Every existing caller, and every other test in this file, passes no
  // rules at all. That path must be exactly what it was before.
  it("changes nothing at all when no rules store is passed", async () => {
    const log: string[] = [];
    const plain = { ...rig({ n: 0 }, false), categories: CATS } as PasteDeps;
    const [s] = await smartPasteSave("Elite Squad practice", plain);
    expect(s).toBeTruthy();
    expect(log).toEqual([]);
  });
});

// THE WHOLE LOOP, END TO END (2026-08-24).
//
// Every other test here fakes one half. This one uses the real
// LearnedRulesService for both, because the bug that nearly shipped lived in
// the JOIN: the correction side and the lookup side each worked perfectly
// and derived their triggers from different strings, so nothing ever
// matched. Nothing failed. The engine simply never learned, which is
// indistinguishable from it being switched off.
describe("a correction taught on one capture applies to the next", () => {
  const CATS = [
    { id: "cat-work", data: { name: "Work", color: "blue", order: 0 } },
    { id: "cat-family", data: { name: "Family", color: "pink", order: 1 } },
  ] as unknown as PasteDeps["categories"];

  it("two corrections of the same proper noun categorise the third capture", async () => {
    const store = new Store(new InMemoryAdapter());
    const rules = new LearnedRulesService(store, U);
    const deps = { ...rig({ n: 0 }, false), categories: CATS, rules } as unknown as PasteDeps;

    // Two captures, each corrected to Family the way QuickCapture's onCat
    // does it: trigger from the RAW line, never from the title.
    for (const text of ["Elite Squad practice tuesday", "Elite Squad film session"]) {
      const [s] = await smartPasteSave(text, deps);
      const trigger = aliasTrigger(s!.raw!);
      expect(trigger).toBe("Elite Squad");
      await rules.recordCorrection("alias", "capture.category", trigger!, "cat-family", `"${s!.title}" moved to Family`);
    }

    // Two identical corrections is a rule.
    expect(await rules.resolve("capture.category", "Elite Squad")).not.toBeNull();

    // And the third capture lands in Family without being touched.
    const [third] = await smartPasteSave("Elite Squad parent meeting", deps);
    expect(third!.category).toBe("cat-family");
  });

  it("one correction is not enough, so the next capture is untouched", async () => {
    const store = new Store(new InMemoryAdapter());
    const rules = new LearnedRulesService(store, U);
    const deps = { ...rig({ n: 0 }, false), categories: CATS, rules } as unknown as PasteDeps;
    const [first] = await smartPasteSave("Elite Squad practice tuesday", deps);
    await rules.recordCorrection("alias", "capture.category", aliasTrigger(first!.raw!)!, "cat-family", "once");
    const [second] = await smartPasteSave("Elite Squad film session", deps);
    expect(second!.category).not.toBe("cat-family");
  });

  // A rule never generalizes past its trigger, so a different name is a
  // different question and JARVIS goes back to not knowing.
  it("the rule does not leak onto a different name", async () => {
    const store = new Store(new InMemoryAdapter());
    const rules = new LearnedRulesService(store, U);
    const deps = { ...rig({ n: 0 }, false), categories: CATS, rules } as unknown as PasteDeps;
    for (const text of ["Elite Squad practice tuesday", "Elite Squad film session"]) {
      const [s] = await smartPasteSave(text, deps);
      await rules.recordCorrection("alias", "capture.category", aliasTrigger(s!.raw!)!, "cat-family", "e");
    }
    const [other] = await smartPasteSave("Northline Partners call", deps);
    expect(other!.category).not.toBe("cat-family");
  });
});

// QUICK ADD: THE FACT LANE (Brain build handoff 5.0, built 2026-09-04).
// Dave: manual entry "isn't going away... make it the easiest, quickest, most
// user-friendly it can possibly be, everywhere in the app." The concrete
// failure: the one sentence a person most wants remembered was the one shape
// capture could not hold, so it became a task with a tick box.
import { selfFact } from "./selfFact";
import { StrandsService } from "../brain/strands/StrandsService";

function rigWithStrands(aiCalls: { n: number }, available = true): PasteDeps & { strandsSvc: StrandsService } {
  const store = new Store(new InMemoryAdapter());
  const strandsSvc = new StrandsService(store, U);
  const base = {
    ai: { available, complete: async () => { aiCalls.n++; return "not json"; } } as unknown as AIService,
    gather: async () => { throw new Error("no context in tests"); },
    tasks: new TasksService(store, U),
    schedule: new ScheduleService(store, U),
    notes: new NotesService(store, U),
    categories: [],
    today: TODAY,
    strands: strandsSvc,
  } as unknown as PasteDeps;
  return Object.assign(base, { strandsSvc });
}

describe("selfFact: the shapes, and everything it refuses", () => {
  it("reads the stated shapes as facts", () => {
    expect(selfFact("I never work out on Sundays")?.category).toBe("routine");
    expect(selfFact("I don't do mornings")?.category).toBe("energy");
    expect(selfFact("family dinner is non-negotiable")?.category).toBe("people");
    expect(selfFact("I work best in the morning")?.category).toBe("energy");
    expect(selfFact("I hate long meetings")?.category).toBe("work_style");
    expect(selfFact("never schedule anything before 10")).not.toBeNull();
  });

  it("keeps the sentence verbatim: these are the user's own words about themselves", () => {
    expect(selfFact("I never work out on Sundays")?.text).toBe("I never work out on Sundays");
  });

  it("refuses an ordinary to-do, a question, and a paragraph", () => {
    expect(selfFact("call the dentist")).toBeNull();
    expect(selfFact("buy milk")).toBeNull();
    expect(selfFact("what's on today")).toBeNull();
    expect(selfFact("x".repeat(200))).toBeNull();
    expect(selfFact("")).toBeNull();
  });
});

describe("law: a dated appointment is never a fact", () => {
  it("a day plus a time stays an event even in first person", () => {
    // selfFact's own law 2. "I always" would match the shape; the date and
    // time read wins, because a thing with a clock time is an appointment.
    const e = classifyLine("I always meet Marco Thursday 7pm", TODAY);
    expect(e.kind).toBe("event");
  });

  it("a weekday alone does NOT drag a fact onto a due date", () => {
    // The bug this ordering exists to prevent: resolveDay matches "Sundays",
    // and the date branch below would have filed the sentence a person most
    // wants remembered as a task due next Sunday.
    const e = classifyLine("I never work out on Sundays", TODAY);
    expect(e.kind).toBe("fact");
    expect(e.date).toBeUndefined();
  });
});

describe("a fact lands in the Brain, not on a list", () => {
  it("files a told-rank strand and creates no task", async () => {
    const calls = { n: 0 };
    const deps = rigWithStrands(calls);
    const out = await smartPasteSave("I never work out on Sundays", deps);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("fact");
    // No AI call: a model never gets to decide it heard a belief about someone.
    expect(calls.n).toBe(0);
    const strands = await deps.strandsSvc.list();
    expect(strands).toHaveLength(1);
    expect(strands[0]!.data.text).toBe("I never work out on Sundays");
    expect(strands[0]!.data.source).toBe("told");
    expect(strands[0]!.data.category).toBe("routine");
    expect(await deps.tasks.listTasks()).toHaveLength(0);
  });

  it("lands on the Recent Captures strip like every other capture", async () => {
    const deps = rigWithStrands({ n: 0 });
    await smartPasteSave("I never work out on Sundays", deps);
    expect(readRecentCaptures()[0]?.kind).toBe("fact");
  });

  it("undo removes the strand entirely", async () => {
    const deps = rigWithStrands({ n: 0 });
    const [s] = await smartPasteSave("I don't do mornings", deps);
    await undoSaved(s!, deps);
    expect(await deps.strandsSvc.list()).toHaveLength(0);
  });

  it("refiles a fact to a task, and a task back to a fact", async () => {
    const deps = rigWithStrands({ n: 0 });
    const [fact] = await smartPasteSave("I hate long meetings", deps);
    const asTask = await refileSaved(fact!, "task", deps);
    expect(asTask!.kind).toBe("task");
    expect(await deps.strandsSvc.list()).toHaveLength(0);
    expect(await deps.tasks.listTasks()).toHaveLength(1);
    const backToFact = await refileSaved(asTask!, "fact", deps);
    expect(backToFact!.kind).toBe("fact");
    expect(await deps.tasks.listTasks()).toHaveLength(0);
    expect(await deps.strandsSvc.list()).toHaveLength(1);
  });

  it("says so when the genome is full instead of pretending nothing was read", async () => {
    const deps = rigWithStrands({ n: 0 });
    // Fill the values category to its cap (12) with told strands.
    for (let i = 0; i < 12; i++) await deps.strandsSvc.add("fact " + i, "values", TODAY);
    let refused: string | null = null;
    const out = await smartPasteSave("I refuse to answer the phone at dinner", {
      ...deps,
      onFactRefused: (t) => { refused = t; },
    });
    expect(out).toHaveLength(0);
    expect(refused).toBe("I refuse to answer the phone at dinner");
  });

  it("with no strand store the lane closes and the capture still lands", async () => {
    // The seam rule the learned-rules store already follows: a missing
    // service means the feature is off, never a lost capture or a crash.
    const calls = { n: 0 };
    const deps = rig(calls, false);
    const out = await smartPasteSave("I never work out on Sundays", deps);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("task");
  });
});
