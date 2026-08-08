import { describe, it, expect } from "vitest";
import { firstStepPrompt, parseFirstStep } from "./firstStep";

// Brain Personalization Phase 3 (2026-08-07). Before this, both First Step
// call sites called the model with NO system prompt at all.

describe("firstStepPrompt", () => {
  it("always carries the JARVIS voice, which is what it used to be missing", () => {
    const { system } = firstStepPrompt("Call the accountant", "task");
    expect(system).toContain("You are JARVIS");
    expect(system).toContain("Never use em dashes");
    expect(system).toContain("Never guilt or shame");
  });

  it("never lets the model scold the user for the delay", () => {
    const { system } = firstStepPrompt("Call the accountant", "task");
    expect(system).toContain("never imply the user should have started sooner");
  });

  it("words a stuck task and a stuck project differently, same rules", () => {
    const task = firstStepPrompt("Call the accountant", "task");
    const proj = firstStepPrompt("LLC formation", "project");
    expect(task.user).toContain("keeps putting off");
    expect(task.user).toContain("Call the accountant");
    expect(proj.user).toContain("no next action");
    expect(proj.user).toContain("LLC formation");
    expect(task.system).toBe(proj.system); // one feature, one system prompt
  });

  it("includes the person's identity context when there is any", () => {
    const { system } = firstStepPrompt("Call the accountant", "task", "Goals: Ship JARVIS\nValues: build things that last");
    expect(system).toContain("About this person:");
    expect(system).toContain("Ship JARVIS");
    expect(system).toContain("build things that last");
  });

  it("omits the identity block entirely when context is empty or blank", () => {
    expect(firstStepPrompt("x", "task").system).not.toContain("About this person:");
    expect(firstStepPrompt("x", "task", "   \n  ").system).not.toContain("About this person:");
  });
});

describe("parseFirstStep", () => {
  it("takes the first real line and drops bonus commentary", () => {
    expect(parseFirstStep("Open the folder on your desk\nThen once that is done...")).toBe("Open the folder on your desk");
  });

  it("skips leading blank lines", () => {
    expect(parseFirstStep("\n\n  Text Jen one sentence  ")).toBe("Text Jen one sentence");
  });

  it("strips wrapping quotes the model adds despite being told not to", () => {
    expect(parseFirstStep('"Open the folder"')).toBe("Open the folder");
  });

  it("returns null for nothing usable, so the caller can fail honestly", () => {
    expect(parseFirstStep("")).toBeNull();
    expect(parseFirstStep("   \n  \n ")).toBeNull();
    expect(parseFirstStep('""')).toBeNull();
  });
});
