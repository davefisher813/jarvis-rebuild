import { describe, it, expect } from "vitest";
import { allDoneLine, progressLabel, stepDoneLine, stopLine, undoLine, workedLine } from "./messages";
import type { Encouragement } from "./prefs";

const STYLES: Encouragement[] = ["factual", "warm", "minimal"];

describe("the words", () => {
  it("the count is one labelled quantity of this task's own steps", () => {
    expect(progressLabel(1, 4)).toBe("1 of 4 Complete");
    expect(progressLabel(0, 3)).toBe("0 of 3 Complete");
  });

  it("factual says what is now true", () => {
    expect(stepDoneLine("factual", 2, 5)).toBe("Step Done · 2 of 5 Complete");
  });

  it("warm keeps the same facts", () => {
    expect(stepDoneLine("warm", 2, 5)).toBe("Nice Work · 2 of 5 Complete");
  });

  it("minimal is only that it happened", () => {
    expect(stepDoneLine("minimal", 2, 5)).toBe("Done");
  });

  it("the last step is a milestone that leaves the task itself to its own tap", () => {
    expect(allDoneLine("factual")).toMatch(/close the task/i);
    expect(allDoneLine("factual")).not.toMatch(/task (is )?(complete|finished|done)\b/i);
  });

  it("no style scolds, scores, compares, or calls a stop a failure", () => {
    const BAD = /streak|score|points?\b|level|rank|best|record|behind|overdue|late|failed|fail\b|give up|gave up|unfinished|incomplete|undone task|missed|lost|%/i;
    for (const s of STYLES) {
      for (const line of [stepDoneLine(s, 1, 4), allDoneLine(s), workedLine(s), stopLine(s), undoLine(s)]) {
        expect(line, line).not.toMatch(BAD);
      }
    }
  });

  it("an undo is plain and carries no shame", () => {
    for (const s of STYLES) expect(undoLine(s)).not.toMatch(/oops|sorry|mistake|wrong/i);
  });

  it("no em dash or percent anywhere", () => {
    for (const s of STYLES) {
      for (const line of [stepDoneLine(s, 1, 4), allDoneLine(s), workedLine(s), stopLine(s), undoLine(s)]) {
        expect(line).not.toMatch(/\u2014|%/);
      }
    }
  });
});
