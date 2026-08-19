// Break It Down (Dave 2026-08-19, ADHD round). The parser is the risky part:
// a model that ignores the format must still produce a usable list, and the
// prompt must forbid the steps that are themselves the avoidance.
import { describe, it, expect } from "vitest";
import { breakdownPrompt, parseBreakdown } from "./breakdown";

describe("breakdownPrompt", () => {
  it("bans the vague steps that are the thing being avoided", () => {
    const p = breakdownPrompt("Create Bridge Invoice");
    expect(p.system).toMatch(/'plan', 'think about', 'organize', or 'figure out'/);
    expect(p.system).toMatch(/3 or 4 steps/);
    expect(p.user).toContain("Create Bridge Invoice");
  });

  it("carries the person's identity when there is one", () => {
    expect(breakdownPrompt("x", "Runs a nonprofit").system).toContain("Runs a nonprofit");
    expect(breakdownPrompt("x").system).not.toContain("About the person");
  });
});

describe("parseBreakdown", () => {
  it("takes clean lines straight through", () => {
    expect(parseBreakdown("Pull August hours\nFill the template\nSend to Wei"))
      .toEqual(["Pull August hours", "Fill the template", "Send to Wei"]);
  });

  it("strips the list furniture a model reaches for anyway", () => {
    expect(parseBreakdown("1. Pull hours\n- Fill it in\n* Send it\n• Archive it"))
      .toEqual(["Pull hours", "Fill it in", "Send it", "Archive it"]);
  });

  it("drops preamble lines and caps at four steps", () => {
    const out = parseBreakdown("Here are the steps:\nOne\nTwo\nThree\nFour\nFive");
    expect(out).not.toContain("Here are the steps:");
    expect(out).toHaveLength(4);
  });

  it("never throws on junk, it just yields nothing", () => {
    expect(parseBreakdown("")).toEqual([]);
    expect(parseBreakdown(undefined as unknown as string)).toEqual([]);
  });
});
