import { describe, it, expect } from "vitest";
import {
  startAction, shapeOf, promptFor, blockerOf, firstOpenStep,
  type StartTarget, type StartContext,
} from "./startAction";
import type { TaskData } from "../notes/types";

const task = (text: string, data: Partial<TaskData> = {}): StartTarget => ({
  kind: "task",
  id: "t1",
  title: text,
  data: { text, category: "life", done: false, ...data },
});

describe("startAction: what is already openable", () => {
  it("never returns a timer, a block, or a completed anything", () => {
    const cases: StartTarget[] = [
      task("Send team practice details"),
      task("Pack for practice"),
      task("Clean up backend storage"),
      task("Create AI agent family"),
      task("Pay the water bill", { bill: { amount: 40, payUrl: "https://pay.example" } }),
      { kind: "project", id: "p1", title: "Jarvis V1" },
      { kind: "goal", id: "g1", title: "Ship it" },
    ];
    for (const t of cases) {
      const a = startAction(t);
      expect(a.completion.completesTask, t.title).toBe(false);
      expect(JSON.stringify(a), t.title).not.toMatch(/timer|countdown|minutes|clock/i);
    }
  });

  it("a blocker the user named beats everything else, and a nudge does not clear it", () => {
    const t = task("Confirm equipment order", {
      blockedBy: { what: "Waiting for a revised quote", since: "2026-09-14" },
      steps: [{ text: "Call the rep", done: false }],
    });
    const a = startAction(t, { resource: { kind: "note", id: "n1", label: "Quote notes" } });
    expect(a.kind).toBe("resolve_blocker");
    expect(a.launchLabel).toBe("Unblock");
    expect(a.ready).toBe("Waiting for a revised quote");
    // The step and the note were both available and both lost to the blocker.
    expect(a.completion.saves).toBe("draft");
    expect(a.completion.completesTask).toBe(false);
  });

  it("a malformed blocker is not a blocker", () => {
    expect(blockerOf({ text: "x", category: "", done: false })).toBeNull();
    expect(blockerOf({ text: "x", category: "", done: false, blockedBy: { what: "  ", since: "" } })).toBeNull();
    expect(blockerOf({ text: "x", category: "", done: false, blockedBy: { what: "No quote", since: "2026-01-01" } }))
      .toEqual({ what: "No quote", since: "2026-01-01" });
  });

  it("saved work wins over everything but the blocker, and comes back verbatim", () => {
    const saved = { entityId: "t1", kind: "prepare_draft" as const, draft: "Hi everyone,\n\nPractice is Saturday", savedAt: 5 };
    const a = startAction(task("Send team practice details"), { saved });
    expect(a.kind).toBe("resume");
    expect(a.launchLabel).toBe("Resume");
    expect(a.seed).toBe("Hi everyone,\n\nPractice is Saturday");
    expect(a.verb).toBe("Save Draft");
  });

  it("a workspace opened and left empty is not resumable", () => {
    const saved = { entityId: "t1", kind: "prepare_draft" as const, draft: "   ", savedAt: 5 };
    const a = startAction(task("Send team practice details"), { saved });
    expect(a.kind).not.toBe("resume");
  });

  it("a stopping point with no draft is still worth resuming", () => {
    const saved = { entityId: "t1", kind: "capture_next_action" as const, stopPoint: "Left off at the roster", savedAt: 5 };
    const a = startAction(task("Finish Jarvis visuals"), { saved });
    expect(a.kind).toBe("resume");
    expect(a.ready).toBe("Left off at the roster");
    expect(a.verb).toBe("Save First Step");
    expect(a.completion.saves).toBe("step_new");
  });
});

describe("startAction: children before anything invented", () => {
  it("the first unfinished step is the opening move, in the user's own order", () => {
    const t = task("Finish Jarvis visuals", {
      steps: [
        { text: "Read the feedback", done: true },
        { text: "Fix the headliner", done: false },
        { text: "Ship it", done: false },
      ],
    });
    const a = startAction(t);
    expect(a.kind).toBe("open_child_task");
    expect(a.ready).toBe("Fix the headliner");
    expect(a.sources[0]!.label).toBe("Step 2 of 3");
    // Ticking a step ticks the step.
    expect(a.completion.saves).toBe("step_tick");
    expect(a.completion.completesTask).toBe(false);
  });

  it("a project starts through a real child, never an invented plan", () => {
    const a = startAction(
      { kind: "project", id: "p1", title: "Jarvis V1" },
      { children: [{ id: "c1", title: "Finish the visuals" }, { id: "c2", title: "Write the docs" }] },
    );
    expect(a.kind).toBe("open_child_task");
    expect(a.ready).toBe("Finish the visuals");
    expect(a.destination).toEqual({ kind: "task", id: "c1" });
    expect(a.completion.saves).toBe("none");
  });

  it("a project with no children asks for one job, and never drafts a plan", () => {
    const a = startAction({ kind: "project", id: "p1", title: "Create AI agent family" });
    expect(a.kind).toBe("capture_next_action");
    expect(a.prompt).toBe("What is one job this needs done?");
    expect(a.missing).toEqual([]);
  });

  it("firstOpenStep skips blanks and finished steps", () => {
    expect(firstOpenStep({ text: "", category: "", done: false, steps: [{ text: "  ", done: false }, { text: "Real", done: false }] }))
      .toEqual({ text: "Real", index: 1 });
    expect(firstOpenStep({ text: "", category: "", done: false, steps: [{ text: "a", done: true }] })).toBeNull();
    expect(firstOpenStep(undefined)).toBeNull();
  });
});

describe("startAction: linked resources open the real thing", () => {
  it("a linked note is opened, not described", () => {
    const a = startAction(task("Finish Jarvis visuals"), {
      resource: { kind: "note", id: "n9", label: "Health feedback" },
    });
    expect(a.kind).toBe("open_resource");
    expect(a.verb).toBe("Open Note");
    expect(a.destination).toEqual({ kind: "note", id: "n9" });
    expect(a.ready).toBe("Health feedback");
    expect(a.completion.saves).toBe("none");
  });

  it("a bill's own pay page is the opening move", () => {
    const a = startAction(task("Pay the water bill", { bill: { amount: 40 } }), {
      resource: { kind: "url", id: "https://pay.example", label: "The pay page" },
    });
    expect(a.destination).toEqual({ kind: "url", id: "https://pay.example" });
    expect(a.verb).toBe("Open the Page");
  });
});

describe("startAction: drafts are grounded or honest", () => {
  it("a message task with verified grounding opens an editable draft, and names its holes", () => {
    const a = startAction(task("Send team practice details"), {
      grounding: {
        lines: ["Hi everyone,", "Practice is Saturday at 2 PM."],
        sources: [{ kind: "event", id: "e1", label: "Source: Saturday practice" }],
        missing: ["Location still needed"],
      },
    });
    expect(a.kind).toBe("prepare_draft");
    expect(a.ready).toBe("Editable message ready");
    expect(a.seed).toBe("Hi everyone,\n\nPractice is Saturday at 2 PM.");
    expect(a.missing).toEqual(["Location still needed"]);
    expect(a.completion.saves).toBe("draft");
    expect(a.completion.completesTask).toBe(false);
  });

  it("a message task with nothing linked says so instead of inventing a message", () => {
    const a = startAction(task("Email Nadia about the invoice"));
    expect(a.kind).toBe("prepare_draft");
    expect(a.seed).toBe("");
    expect(a.ready).toBe("Start the message");
    expect(a.missing).toEqual([]);
  });

  it("an automated sender is never turned into somebody to reply to", () => {
    // The addresses are the shared detector's own (messages/noReply.ts), not
    // a second list invented here: a no-reply is the same object on this
    // screen as it is in the inbox.
    for (const addr of ["no-reply@github.com", "notifications@ci.example", "donotreply@x.com", "mailer-daemon@x.com"]) {
      const a = startAction(task("Reply to the failed build notice"), { fromEmailAddress: addr });
      expect(a.kind, addr).toBe("capture_next_action");
      expect(a.prompt, addr).toBe("Which error do you need to look at?");
      expect(a.ready, addr).toBe("Capture the error to look at");
    }
    // A real person on the same shaped task still gets the draft.
    const human = startAction(task("Reply to Nadia"), { fromEmailAddress: "nadia@school.org" });
    expect(human.kind).toBe("prepare_draft");
  });
});

describe("startAction: physical work and vague work", () => {
  // THE MAD-LIB IS GONE (2026-09-16). Dave photographed "Set up wallet card"
  // answered with "Put what you need for set up wallet card within reach"
  // and asked how that was a first step. It was not one: it was the title
  // pasted into a sentence frame. The app asks instead.
  it("a task it knows nothing about asks, and never manufactures an instruction", () => {
    for (const title of ["Set up wallet card", "Pack for practice", "Buy milk", "Install the shelf"]) {
      const a = startAction(task(title));
      expect(a.kind, title).toBe("capture_next_action");
      expect(a.verb, title).toBe("Save First Step");
      // The answer is a QUESTION, and the title is never pasted into it.
      expect(a.prompt, title).toMatch(/\?$/);
      expect(a.prompt!.toLowerCase(), title).not.toContain(title.toLowerCase());
      expect(a.ready, title).toBe("Start by naming the first step");
      expect(a.completion.saves, title).toBe("step_new");
      expect(a.completion.completesTask, title).toBe(false);
    }
  });

  it("Mark It Done is only ever offered against a step somebody actually wrote", () => {
    // No step on the task: nothing is offered as done-able.
    const bare = startAction(task("Pack for practice"));
    expect(bare.verb).not.toBe("Mark It Done");
    expect(bare.completion.saves).not.toBe("step_tick");
    // His own step: now ticking it is honest, and it ticks the step only.
    const withStep = startAction(task("Pack for practice", { steps: [{ text: "Put the bag by the door", done: false }] }));
    expect(withStep.verb).toBe("Mark It Done");
    expect(withStep.ready).toBe("Put the bag by the door");
    expect(withStep.completion.saves).toBe("step_tick");
    expect(withStep.completion.completesTask).toBe(false);
  });

  it("a vague task gets exactly one question, never a questionnaire", () => {
    const a = startAction(task("Create AI agent family"));
    expect(a.kind).toBe("capture_next_action");
    expect(a.prompt).toBe("What is the first thing you would do?");
    // One prompt, and nothing that asks for duration, energy, mood or priority.
    expect(JSON.stringify(a)).not.toMatch(/energy|mood|difficulty|priority|how long/i);
  });

  it("the shape only ever picks a question, so a wrong guess costs a question", () => {
    expect(shapeOf("Clean up backend storage")).toBe("inspect");
    expect(shapeOf("Send team practice details")).toBe("comms");
    expect(shapeOf("Create AI agent family")).toBe("vague");
    expect(shapeOf("Clean the kitchen")).toBe("vague");
    // Every shape resolves to an interrogative, never to an instruction.
    for (const shape of ["comms", "inspect", "vague"] as const) {
      expect(promptFor(shape, "task"), shape).toMatch(/\?$/);
    }
    expect(promptFor("inspect", "task")).toBe("What is the first thing to look at?");
  });

  it("an inspection with nothing connected asks what to look at", () => {
    const a = startAction(task("Clean up backend storage"));
    expect(a.kind).toBe("capture_next_action");
    expect(a.prompt).toBe("What is the first thing to look at?");
    expect(a.ready).toBe("Start by naming the first step");
  });
});

describe("startAction: the same call twice is the same answer", () => {
  it("is pure, so a repeated Start cannot drift", () => {
    const t = task("Send team practice details");
    const ctx: StartContext = { grounding: { lines: ["Hi"], sources: [], missing: [] } };
    expect(startAction(t, ctx)).toEqual(startAction(t, ctx));
  });
});
