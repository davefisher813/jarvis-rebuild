// JARVIS ON A SELECTION (the writing system, wave 4): six asks with prompts
// that keep the person's meaning, a reply that is never a guess, and a task
// from a passage.
import { describe, it, expect, vi } from "vitest";
import { AI_ACTIONS, promptFor, runAction, taskFromPassage } from "./aiActions";
import type { AIService } from "../ai/AIService";

describe("the prompts", () => {
  it("name six asks, each keeping meaning and structure, and Prepare for Claude asks for the five headings and what is missing", () => {
    expect(AI_ACTIONS.map((a) => a.key)).toEqual(["typos", "clearer", "shorten", "sections", "checklist", "claude"]);
    for (const a of AI_ACTIONS) {
      const p = promptFor(a.key, "Call Berto about the lease");
      expect(p.system).toContain("Never add facts that are not in the text");
      expect(p.user).toContain("Call Berto about the lease");
    }
    const claude = promptFor("claude", "x").user;
    for (const h of ["## Objective", "## Current Problems", "## Requested Changes", "## Constraints", "## Acceptance Criteria", "## Missing Details"]) expect(claude).toContain(h);
    expect(claude).toContain("Ask, never guess");
    expect(promptFor("typos", "x").user).toContain("Change nothing else");
    expect(promptFor("checklist", "x").user).toContain("- [ ] ");
  });
});

describe("running one", () => {
  it("returns the reply cleaned, strips a code fence, and refuses an empty reply", async () => {
    const complete = vi.fn().mockResolvedValueOnce("```markdown\n## Plan\n- one\n```").mockResolvedValueOnce("   ");
    const ai = { available: true, complete } as unknown as AIService;
    expect(await runAction(ai, "sections", "plan one")).toBe("## Plan\n- one");
    expect(complete.mock.calls[0]![2]).toMatchObject({ tier: "write", kind: "notes-sections" });
    await expect(runAction(ai, "typos", "x")).rejects.toThrow("JARVIS had nothing to offer");
  });
});

describe("a task from a passage", () => {
  it("takes the first line as the task, the whole passage as its notes, and never a marker", () => {
    expect(taskFromPassage("- [ ] Renew the lease\n- [ ] Talk pricing")).toEqual({ title: "Renew the lease", notes: "- [ ] Renew the lease\n- [ ] Talk pricing" });
    expect(taskFromPassage("## Send the contract\nBefore Friday").title).toBe("Send the contract");
    expect(taskFromPassage("x".repeat(200)).title.length).toBeLessThanOrEqual(120);
    expect(taskFromPassage("   ").title).toBe("Untitled task");
  });
});
