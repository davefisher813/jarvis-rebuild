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

// PLUMB-F-05 (2026-09-05). Three regexes were loose enough to read a date out
// of ordinary English, the title cleaner deleted the words they matched even
// when the resolver had refused them, a time with no day was thrown away, and
// the AI fallback was handed the wreckage instead of the line.
describe("PLUMB-F-05: dates are only read where a date was written", () => {
  it("a time with no day keeps the time, as today's event", () => {
    const e = classifyLine("call Marcus 10am", TODAY);
    expect(e).toMatchObject({ kind: "event", date: TODAY, start: "10:00", confident: true });
    expect(e.title).toBe("Call Marcus");
  });

  it("a month abbreviation inside a longer word is not a month", () => {
    // "nov" out of "Nova", "sep" out of "separate", "mar" out of "Mark".
    const deck = classifyLine("review Nova 2 deck", TODAY);
    expect(deck.date).toBeUndefined();
    expect(deck.title).toBe("Review Nova 2 Deck");
    expect(resolveDay("separate 2 accounts", TODAY)).toBeNull();
    expect(resolveDay("mark 5 items done", TODAY)).toBeNull();
  });

  it("a counted number is a count, not a day of the month", () => {
    const e = classifyLine("email Jan 4 times", TODAY);
    expect(e.date).toBeUndefined();
    expect(e.title).toBe("Email Jan 4 Times");
  });

  it("a three-letter weekday needs a time beside it to count as a day", () => {
    expect(resolveDay("I sat with Dave", TODAY)).toBeNull();
    expect(classifyLine("I sat with Dave", TODAY).title).toBe("I Sat with Dave");
    // Next to a clock time it is a day again.
    expect(resolveDay("sat 9am", TODAY, true)).toBe("2026-08-22");
    expect(classifyLine("dinner sat 9am", TODAY)).toMatchObject({ kind: "event", date: "2026-08-22", start: "09:00" });
  });

  it("full month and weekday names still resolve", () => {
    expect(resolveDay("august 20", TODAY)).toBe("2026-08-20");
    expect(resolveDay("sept 20", TODAY)).toBe("2026-09-20");
    expect(resolveDay("wednesday", TODAY)).toBe("2026-08-19");
  });

  it("the title loses only the words the date actually came from", () => {
    // The old cleaner ran its own patterns over the line, so a refused match
    // still cost the title its words.
    expect(classifyLine("separate 2 accounts", TODAY).title).toBe("Separate 2 Accounts");
    expect(classifyLine("dinner with marco on thursday at 7pm", TODAY).title).toBe("Dinner with Marco");
  });

  it("the AI fallback is handed the line as pasted, not the cleaned title", async () => {
    const seen: string[] = [];
    const store = new Store(new InMemoryAdapter());
    const deps = {
      ai: { available: true, complete: async (msgs: { content: string }[]) => { seen.push(msgs[0]!.content); return "not json"; } } as unknown as AIService,
      gather: async () => ({ categories: [] }) as unknown as AIContext,
      tasks: new TasksService(store, U),
      schedule: new ScheduleService(store, U),
      notes: new NotesService(store, U),
      categories: [],
      today: TODAY,
    } as unknown as PasteDeps;
    await smartPasteSave("separate 2 accounts", deps);
    expect(seen).toEqual(["separate 2 accounts"]);
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
    // SHELL-F-06 (2026-09-05): the receipt's field was the only thing this
    // asserted, and the receipt lit the Family chip while the STORED task had
    // no category at all (applyCapture matched the rule's id against names).
    // The row in Tasks is what he opens next, so it is what this checks.
    const stored = (await deps.tasks.listTasks()).find((t) => t.id === third!.id);
    expect(stored?.data.category).toBe("cat-family");
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
import { decisionLine } from "./decisionLine";
import { personLine, personReceipt } from "./personLine";

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

  // SHELL-F-02 (2026-09-05): the audit's repro. Refiling a task to Fact
  // with the target bucket full used to delete the task FIRST and then be
  // refused by strands.add, leaving nothing anywhere. The refusal now costs
  // nothing: null back, task still there.
  it("refile to Fact when the Brain is full refuses and keeps the original", async () => {
    const deps = rigWithStrands({ n: 0 });
    const [saved] = await smartPasteSave("call the plumber back", deps);
    expect(saved!.kind).toBe("task");
    // "call the plumber back" matches no fact shape, so it files under values.
    for (let i = 0; i < 12; i++) await deps.strandsSvc.add("fact " + i, "values", TODAY);
    const next = await refileSaved(saved!, "fact", deps);
    expect(next).toBeNull();
    expect(await deps.tasks.listTasks()).toHaveLength(1);
    expect(await deps.tasks.task(saved!.id)).not.toBeNull();
    expect(await deps.strandsSvc.list()).toHaveLength(12);
  });

  it("refile to Fact with no Brain at all refuses and keeps the original", async () => {
    const deps = rig({ n: 0 }, false);
    const [saved] = await smartPasteSave("call the plumber back", deps);
    const next = await refileSaved(saved!, "fact", deps);
    expect(next).toBeNull();
    expect(await deps.tasks.task(saved!.id)).not.toBeNull();
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

// UP-CORE-01 (2026-09-05): the front door reads the shapes the rest of the
// app already stores. Every one of these fields has existed on TaskData
// since the day it was written; capture simply never filled them in, so
// "meds 9pm every day" landed as a nine PM event.
describe("capture reads reminders, repeats, bills and people", () => {
  it("a clock time that repeats every day is a reminder, not an event", () => {
    const e = classifyLine("meds 9pm every day", TODAY);
    expect(e.kind).toBe("task");
    expect(e.reminder).toEqual({ time: "21:00" });
    expect(e.title).toBe("Meds");
    expect(e.confident).toBe(true);
  });

  it("remind me says outright which lane it is", () => {
    const e = classifyLine("remind me to take the bins out at 7:30am", TODAY);
    expect(e.reminder).toEqual({ time: "07:30" });
    expect(e.kind).toBe("task");
  });

  it("every weekday is a reminder on the five weekdays", () => {
    expect(classifyLine("stretch 7am every weekday", TODAY).reminder).toEqual({ time: "07:00", days: [1, 2, 3, 4, 5] });
  });

  // A repeat on a NAMED weekday is a commitment, not a habit: the calendar
  // is where it belongs, and the recurrence rides with it.
  it("a named weekday with a time stays a repeating event", () => {
    const e = classifyLine("practice every tuesday at 5pm", TODAY);
    expect(e.kind).toBe("event");
    expect(e.recurrence).toBe("weekly");
    expect(e.start).toBe("17:00");
    expect(e.reminder).toBeUndefined();
  });

  it("a repeat with no clock is a repeating task", () => {
    const e = classifyLine("water the plants every week", TODAY);
    expect(e).toMatchObject({ kind: "task", recurrence: "weekly", confident: true });
    expect(e.title).toBe("Water the Plants");
  });

  it("an amount makes it a bill, and the day of the month is a real date", () => {
    const e = classifyLine("$1,200 rent on the 1st", TODAY);
    expect(e.kind).toBe("task");
    expect(e.bill).toEqual({ amount: 1200 });
    expect(e.date).toBe("2026-09-01");
    // No repeat was written, so none is claimed, however obvious rent is.
    expect(e.recurrence).toBeUndefined();
  });

  it("a bare number is never money", () => {
    expect(classifyLine("call 3 people back", TODAY).bill).toBeUndefined();
  });

  it("files the one contact the line names, and asks when two answer", () => {
    const people = [
      { id: "p1", name: "Marco Diaz" },
      { id: "p2", name: "Marco Silva" },
      { id: "p3", name: "Nadia Sorensen" },
    ];
    const one = classifyLine("call Nadia about the invoice", TODAY, { people });
    expect(one.personId).toBe("p3");
    expect(one.personChoices).toBeUndefined();
    const two = classifyLine("text Marco about the invoice", TODAY, { people });
    expect(two.personId).toBeUndefined();
    expect(two.personChoices).toEqual(["p1", "p2"]);
  });

  it("files into a project the person named, and never into one they did not", () => {
    const projects = [{ id: "pr1", title: "Kitchen remodel" }];
    expect(classifyLine("order tile for Kitchen remodel", TODAY, { projects }).projectId).toBe("pr1");
    expect(classifyLine("order tile", TODAY, { projects }).projectId).toBeUndefined();
  });

  it("writes the reminder, the bill and the repeat all the way through to the task", async () => {
    const calls = { n: 0 };
    const deps = rig(calls);
    const saved = await smartPasteSave("meds 9pm every day\n$1,200 rent on the 1st", deps);
    expect(calls.n).toBe(0); // deterministic, no AI call
    const tasks = await deps.tasks.listTasks();
    const meds = tasks.find((t) => t.data.text === "Meds")!;
    expect(meds.data.reminder).toEqual({ time: "21:00" });
    const rent = tasks.find((t) => t.data.bill)!;
    expect(rent.data.bill).toEqual({ amount: 1200 });
    expect(rent.data.due).toBe("2026-09-01");
    // The receipt gets the same facts, so it can show the read.
    expect(saved.find((s) => s.title === "Meds")!.reminder).toEqual({ time: "21:00" });
    expect(saved.find((s) => s.bill)!.bill).toEqual({ amount: 1200 });
  });
});

// UP-CORE-01, the refusals. A reminder has no date, only a time and the days
// it runs, so a line naming a day must never become one: "remind me tomorrow
// at 9" would ping every morning forever.
describe("capture refuses the reads it cannot honestly make", () => {
  it("a dated reminder stays a dated thing", () => {
    const e = classifyLine("remind me to call the bank tomorrow at 9am", TODAY);
    expect(e.reminder).toBeUndefined();
    expect(e).toMatchObject({ kind: "event", date: "2026-08-16", start: "09:00" });
  });

  it("a standing fact about the person is still a fact, not a bill or a ping", () => {
    expect(classifyLine("I never take calls before 9am", TODAY).kind).toBe("fact");
    expect(classifyLine("my rule is $20 a day", TODAY).kind).toBe("fact");
  });
});

// UP-MIND-08 (2026-09-05): two more deterministic lanes, on the fact lane's
// own terms. Shapes or nothing, never the model, and a date means it is not
// one of these.
describe("the decision lane", () => {
  it("reads the shapes people actually type", () => {
    expect(decisionLine("We're going with Ridgeline")?.decision).toBe("We're going with Ridgeline");
    expect(decisionLine("I decided to drop the second vendor")).not.toBeNull();
    expect(decisionLine("We'll use Supabase")).not.toBeNull();
    expect(decisionLine("Decided: mornings for the gym")?.decision).toBe("mornings for the gym");
  });

  it("refuses a question, somebody else's call, and a paragraph", () => {
    expect(decisionLine("Should we go with Ridgeline?")).toBeNull();
    expect(decisionLine("They decided to close early")).toBeNull();
    expect(decisionLine("We decided to " + "x".repeat(300))).toBeNull();
  });

  it("keeps the sentence verbatim and never invents a why", () => {
    const d = decisionLine("We picked Ridgeline")!;
    expect(d.decision).toBe("We picked Ridgeline");
    expect(Object.keys(d)).toEqual(["decision"]);
  });

  it("loses to a dated read, because a date means it is not a decision", () => {
    const { entities } = parsePaste("We decided to meet Thursday 3pm", "2026-08-15");
    expect(entities[0]!.kind).toBe("event");
  });
});

describe("the person lane", () => {
  it("reads a label, a number, an address and a move", () => {
    expect(personLine("Marco is my dentist")).toEqual({ name: "Marco", field: "relationship", value: "dentist" });
    expect(personLine("Sarah's number is 555 0134")).toEqual({ name: "Sarah", field: "phone", value: "555 0134" });
    expect(personLine("Marco's email is marco@example.com")).toEqual({ name: "Marco", field: "email", value: "marco@example.com" });
    expect(personLine("Mike moved to Acme")).toEqual({ name: "Mike", field: "note", value: "Acme" });
  });

  it("refuses a question and anything with no name or no value", () => {
    expect(personLine("Is Marco my dentist?")).toBeNull();
    expect(personLine("m is my dentist")).toBeNull();
    expect(personLine("Marco is my")).toBeNull();
  });

  it("never infers a label from anything but the sentence", () => {
    expect(personLine("Marco emailed me twice today")).toBeNull();
  });

  it("says what happened in the user's own words", () => {
    expect(personReceipt({ name: "Marco", field: "relationship", value: "dentist" })).toBe("Marco is your dentist");
    expect(personReceipt({ name: "Sarah", field: "phone", value: "555" })).toBe("Saved Sarah's number");
  });

  it("is read as a person by the parser, not as a task", () => {
    const { entities } = parsePaste("Marco is my dentist", "2026-08-15");
    expect(entities[0]!.kind).toBe("person");
    expect(entities[0]!.person?.field).toBe("relationship");
  });
});

// 2026-09-11: the person lane's writes, its Undo, and its refile, against the
// real contact store.
import { PeopleService } from "../people/PeopleService";

function rigWithPeople(): PasteDeps & { peopleStore: PeopleService } {
  const store = new Store(new InMemoryAdapter());
  const peopleStore = new PeopleService(store, U);
  const base = {
    ai: { available: false, complete: async () => "not json" } as unknown as AIService,
    gather: async () => { throw new Error("no context in tests"); },
    tasks: new TasksService(store, U),
    schedule: new ScheduleService(store, U),
    notes: new NotesService(store, U),
    categories: [],
    today: TODAY,
    peopleSvc: peopleStore,
  } as unknown as PasteDeps;
  return Object.assign(base, { peopleStore });
}

describe("the person lane on a real card", () => {
  it("adds a note to the card's notes instead of replacing them, once", async () => {
    const deps = rigWithPeople();
    const id = (await deps.peopleStore.create({ name: "Mike", group: "contacts", notes: "Allergic to nuts; kids Ava, Leo" }))!;
    await smartPasteSave("Mike works at Acme", deps);
    expect((await deps.peopleStore.get(id))!.data.notes).toBe("Allergic to nuts; kids Ava, Leo\nAcme");
    // The same line again adds nothing.
    await smartPasteSave("Mike moved to Acme", deps);
    expect((await deps.peopleStore.get(id))!.data.notes).toBe("Allergic to nuts; kids Ava, Leo\nAcme");
  });

  it("Undo clears a field the card did not have and restores the rest", async () => {
    const deps = rigWithPeople();
    const id = (await deps.peopleStore.create({ name: "Sarah", group: "contacts", relationship: "Sister" }))!;
    const [s] = await smartPasteSave("Sarah's number is 555 0134", deps);
    expect((await deps.peopleStore.get(id))!.data.phone).toBe("555 0134");
    await undoSaved(s!, deps);
    const after = (await deps.peopleStore.get(id))!.data;
    expect(after.phone).toBeUndefined();
    expect("phone" in after).toBe(false);
    expect(after).toMatchObject({ name: "Sarah", relationship: "Sister" });
  });

  it("Undo of an appended note puts the old notes back", async () => {
    const deps = rigWithPeople();
    const id = (await deps.peopleStore.create({ name: "Mike", group: "contacts", notes: "Allergic to nuts" }))!;
    const [s] = await smartPasteSave("Mike works at Acme", deps);
    await undoSaved(s!, deps);
    expect((await deps.peopleStore.get(id))!.data.notes).toBe("Allergic to nuts");
  });

  it("refiling to a task or a note keeps what was pasted, not the receipt", async () => {
    const deps = rigWithPeople();
    const id = (await deps.peopleStore.create({ name: "Sarah", group: "contacts" }))!;
    const [s] = await smartPasteSave("Sarah's number is 555 0134", deps);
    expect(s!.title).toBe("Saved Sarah's number");
    const asTask = await refileSaved(s!, "task", deps);
    const task = await deps.tasks.task(asTask!.id);
    expect(task!.text).toContain("555 0134");
    expect(asTask!.title).toBe(task!.text);
    // The card edit was undone by the refile.
    expect((await deps.peopleStore.get(id))!.data.phone).toBeUndefined();

    const [s2] = await smartPasteSave("Sarah's email is sarah@example.com", deps);
    const asNote = await refileSaved(s2!, "note", deps);
    const note = await deps.notes.note(asNote!.id);
    expect(JSON.stringify(note)).toContain("Sarah's email is sarah@example.com");
  });
});

// 2026-09-11: a save that throws partway used to leave the first entity saved
// with nothing holding it: no receipt, no Undo, and the paste not marked seen.
describe("a paste that fails partway", () => {
  it("hands back what landed and marks the paste seen", async () => {
    const deps = rig({ n: 0 }, false);
    const create = deps.tasks.createTask.bind(deps.tasks);
    let n = 0;
    deps.tasks.createTask = (async (...a: Parameters<TasksService["createTask"]>) => {
      if (++n === 2) throw new Error("offline");
      return create(...a);
    }) as TasksService["createTask"];
    const text = "call the plumber back\nrenew the domain";
    const out: import("./smartPaste").SavedEntity[] = [];
    await expect(smartPasteSave(text, deps, out)).rejects.toThrow("offline");
    expect(out).toHaveLength(1);
    expect(await deps.tasks.task(out[0]!.id)).not.toBeNull();
    expect(pasteSeenAge(text)).not.toBeNull();
  });
});
