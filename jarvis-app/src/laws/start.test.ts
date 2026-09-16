import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { startAction, promptFor, type StartTarget } from "../tasks/startAction";

// THE START LAWS (Dave 2026-09-16, the Start Now handoff).
//
// One complaint drives all of them: "a large Start button implies useful
// assistance, yet it merely starts a clock". Each law below is one of the
// promises the replacement makes, written the session the replacement
// landed, and each was proven to bite before it shipped: the violation was
// planted, the law went red naming the file, the violation came out.

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (f: string) => f.slice(SRC.length + 1);
const read = (f: string) => readFileSync(f, "utf8");
/** The CODE, with the comments taken out. These files argue for themselves
 *  at length, and a law that scans the argument flags the file for quoting
 *  the very thing it refuses to do. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RESOLVER = read(join(SRC, "tasks/startAction.ts"));
const GROUND = read(join(SRC, "tasks/startGround.ts"));
const STORE = read(join(SRC, "tasks/startStore.ts"));
const SCREEN = read(join(SRC, "tasks/screens/StartScreen.tsx"));
const CARD = read(join(SRC, "tasks/screens/StartCard.tsx"));
const FLOW = read(join(SRC, "tasks/TasksFlow.tsx"));

// ---------------------------------------------------------------------------

describe("START law 1: Start opens something, and never starts a clock", () => {
  it("nothing on the start path can write to the schedule except the support row", () => {
    for (const [name, src] of [["startAction.ts", RESOLVER], ["startGround.ts", GROUND], ["startStore.ts", STORE], ["StartScreen.tsx", SCREEN], ["StartCard.tsx", CARD]] as const) {
      expect(src, name + " must not reach the calendar").not.toMatch(/createEvent|commitPlan|writeFifteen|focusStarted/);
    }
    // In the flow, the fifteen-minute block survives in exactly one place,
    // and it is the row the person has to press.
    expect(FLOW.match(/schedule\.createEvent/g)?.length, "one block writer in the flow").toBe(1);
    const book = FLOW.slice(FLOW.indexOf("const bookBlock ="));
    expect(book.slice(0, book.indexOf("\n  };")), "and it is bookBlock").toMatch(/schedule\.createEvent/);
    expect(FLOW, "wired to the optional support row, never to Start")
      .toMatch(/onStartTimer=\{\(\) => void bookBlock\(/);
    // Start itself opens the working surface and nothing else.
    expect(FLOW).toMatch(/const onStartTask = async \(id: string\) => \{ await openStart\(id\); \};/);
  });

  it("no action the resolver can return mentions a clock, a length or a deadline", () => {
    const targets: StartTarget[] = [
      { kind: "task", id: "1", title: "Send team practice details", data: { text: "x", category: "", done: false } },
      { kind: "task", id: "2", title: "Pack for practice", data: { text: "x", category: "", done: false } },
      { kind: "task", id: "3", title: "Clean up backend storage", data: { text: "x", category: "", done: false } },
      { kind: "task", id: "4", title: "Confirm order", data: { text: "x", category: "", done: false, blockedBy: { what: "No quote", since: "2026-09-01" } } },
      { kind: "project", id: "5", title: "Jarvis V1" },
      { kind: "goal", id: "6", title: "Ship it" },
    ];
    for (const t of targets) {
      const json = JSON.stringify(startAction(t));
      expect(json, t.title).not.toMatch(/minutes|timer|countdown|clock|due date|deadline/i);
    }
  });
});

describe("START law 2: opening is never finishing", () => {
  it("every action the resolver can return says so in its type and its value", () => {
    // The type cannot express true, and the values agree with the type.
    expect(RESOLVER).toMatch(/completesTask: false;/);
    expect(RESOLVER.match(/completesTask: true/g), "no action may complete a task").toBeNull();
    const kinds = ["Send a note", "Pack a bag", "Review the plan", "Create a thing"];
    for (const title of kinds) {
      const a = startAction({ kind: "task", id: "x", title, data: { text: title, category: "", done: false } });
      expect(a.completion.completesTask, title).toBe(false);
    }
  });

  it("the working surface's primary never ticks the task, and Finish is its own door", () => {
    const primary = FLOW.slice(FLOW.indexOf("const runStartPrimary ="));
    const body = primary.slice(0, primary.indexOf("\n  };"));
    expect(body, "the primary writes notes or steps and nothing else").not.toMatch(/onToggle|toggleDone|setDone/);
    expect(body).toMatch(/svc\.setNotes|svc\.setSteps/);
    // Finishing exists, separately, and says what it is.
    expect(SCREEN).toMatch(/Finish This Task/);
    expect(SCREEN).toMatch(/Ticks the task itself/);
  });
});

describe("START law 3: a blocked thing stays blocked", () => {
  it("the blocker is written by the user and inferred by nobody", () => {
    // setBlocked is the one writer, and Something's in the Way is its one
    // caller. Nothing derives a blocker from a date, a delay or a mood.
    const svc = read(join(SRC, "tasks/TasksService.ts"));
    expect(svc).toMatch(/async setBlocked\(/);
    const callers = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /setBlocked\(/.test(read(f)) && !f.endsWith("TasksService.ts"));
    expect(callers.map(rel), "one caller, and it is the answer to Something's in the Way")
      .toEqual(["tasks/TasksFlow.tsx"]);
    const ans = FLOW.slice(FLOW.indexOf("const answerInTheWay ="));
    expect(ans.slice(0, ans.indexOf("\n  };")), "written from the words he typed").toMatch(/what: text\.trim\(\)|const what = text\.trim\(\)/);
  });

  it("a blocked task resolves to its blocker and is never offered as a place to begin", () => {
    const a = startAction({
      kind: "task", id: "x", title: "Confirm equipment order",
      data: { text: "x", category: "", done: false, steps: [{ text: "Call them", done: false }], blockedBy: { what: "Waiting for a revised quote", since: "2026-09-14" } },
    }, { resource: { kind: "note", id: "n", label: "Notes" } });
    expect(a.kind).toBe("resolve_blocker");
    expect(a.launchLabel).toBe("Unblock");
    // The row says Unblock too, from the same resolver.
    expect(FLOW).toMatch(/if \(t && blockerOf\(t\.data\)\) return "Unblock";/);
    expect(read(join(SRC, "tasks/startPick.ts")), "and the top card skips it")
      .toMatch(/filter\(\(t\) => !blockerOf\(t\.data\)/);
  });
});

describe("START law 4: nothing is invented", () => {
  it("a missing fact is named, never filled in", () => {
    expect(GROUND).toMatch(/missing\.push\("Location still needed"\)/);
    expect(GROUND).toMatch(/missing\.push\("Recipients still needed"\)/);
    // No placeholder prose stands in for a fact the records do not carry.
    expect(code(GROUND)).not.toMatch(/the usual|as always|TBD|somewhere/i);
  });

  it("an automated sender is never turned into somebody to reply to", () => {
    expect(RESOLVER, "the test is the inbox's own, not a second list")
      .toMatch(/import \{ isMachineAddress \} from "\.\.\/messages\/noReply"/);
    const a = startAction(
      { kind: "task", id: "x", title: "Reply to the failed build", data: { text: "x", category: "", done: false } },
      { fromEmailAddress: "no-reply@github.com" },
    );
    expect(a.kind).not.toBe("prepare_draft");
    expect(a.prompt).toMatch(/error/i);
  });

  it("the resolver reads records rather than fetching them, so it cannot reach past what it was given", () => {
    expect(code(RESOLVER), "no services in the pure layer").not.toMatch(/await |fetch\(|Service|localStorage/);
  });
});

// Dave, 2026-09-16, on a screenshot of "Set up wallet card" answered with
// "Put what you need for set up wallet card within reach": "This logic makes
// no sense. How is the first step 'mark it done'".
//
// It made no sense because it was a mad-lib. The title was pasted into a
// sentence frame, and the primary then asked him to certify the result,
// which wrote the invented sentence onto the task as a completed step.
describe("START law 7: the app asks rather than invents, and ticks only what somebody wrote", () => {
  it("no branch builds an instruction out of the task's own title", () => {
    // The tell is string concatenation around the title inside the resolver.
    const body = code(RESOLVER);
    expect(body, "no sentence frame around the title").not.toMatch(/"[^"]*" \+ (lowerFirst\(|title|target\.title)/);
    expect(body, "and the mad-lib helper is gone for good").not.toMatch(/physicalStep|within reach/);
  });

  it("every prompt the classifier can choose is a question", () => {
    const shapes = ["comms", "inspect", "vague"] as const;
    for (const kind of ["task", "project", "goal"] as const) {
      for (const shape of shapes) {
        expect(promptFor(shape, kind), shape + "/" + kind).toMatch(/\?$/);
      }
    }
  });

  it("Mark It Done is offered only against a step that already exists", () => {
    const bare = startAction({ kind: "task", id: "x", title: "Set up wallet card", data: { text: "x", category: "", done: false } });
    expect(bare.verb).not.toBe("Mark It Done");
    expect(bare.completion.saves).toBe("step_new");
    const withStep = startAction({ kind: "task", id: "x", title: "Set up wallet card",
      data: { text: "x", category: "", done: false, steps: [{ text: "Find the card", done: false }] } });
    expect(withStep.verb).toBe("Mark It Done");
    expect(withStep.completion.saves).toBe("step_tick");
    // And the writer can only ever tick a step it found, never push one.
    const tick = FLOW.slice(FLOW.indexOf('case "step_tick"'));
    const tickBody = tick.slice(0, tick.indexOf("      }"));
    expect(tickBody, "nothing is invented to tick").not.toMatch(/steps\.push/);
    expect(tickBody, "no open step means nothing to report").toMatch(/if \(at < 0\) return null;/);
  });

  it("saving never replaces text the task already had", () => {
    const save = FLOW.slice(FLOW.indexOf('case "draft":'));
    const body = save.slice(0, save.indexOf('case "step_new"'));
    expect(body, "the existing notes are read and kept").toMatch(/const had = \(t\.notes \?\? ""\)\.trim\(\)/);
    expect(body, "and appended to, never overwritten").toMatch(/had \? had \+ "\\n\\n" \+ words : words/);
  });
});

describe("START law 5: one workspace per thing, and it is never an event", () => {
  it("the seat is the entity, so repeated Start cannot stack drafts", () => {
    expect(STORE).toMatch(/export function saveSession\(\s*\n?\s*entityId: string/);
    expect(STORE, "an empty workspace takes no seat").toMatch(/if \(!sessionHasWork\(s\)\) \{ delete all\[entityId\]/);
    expect(FLOW, "the screen autosaves into that one seat")
      .toMatch(/saveSession\(starting\.target\.id, \{ kind: starting\.action\.kind, draft: text \}\)/);
  });

  it("no event writer reads the start session, and the store never emits", () => {
    const writers = walk(join(SRC, "events")).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(writers.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of writers) {
      const src = read(f);
      for (const s of ["jarvis.start.session", "tasks/startStore"]) if (src.includes(s)) bad.push(rel(f) + ": " + s);
    }
    expect(bad, "a half-written draft is not event-log material").toEqual([]);
    expect(STORE).not.toMatch(/from "\.\.\/events|\bemit\(/);
  });
});

describe("START law 6: one start door per screen", () => {
  it("the task page never shows the start card and Pick One at once", () => {
    const page = read(join(SRC, "tasks/screens/TasksPage.tsx"));
    // One if-else chain: overwhelmed exit, else the card, else the fallback.
    expect(page).toMatch(/\) : startCard \? \(/);
    expect(page).toMatch(/\) : onPickOne && counts\.all > 0 && \(/);
  });

  it("the card's own primary is the only fill on it", () => {
    expect(CARD.match(/btn-primary/g)?.length).toBe(1);
    expect(SCREEN.match(/btn-primary/g)?.length).toBe(1);
  });
});
