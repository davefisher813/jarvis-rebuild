// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import BiggerPicturePage from "./BiggerPicturePage";
import type { ProjectRow, PaceParts } from "./progress";
import type { GoalReach } from "./reach";

// THE UNLENSED PROJECT ROW'S TWO DERIVED LINES (the Colour Key, §AM,
// 2026-09-26). The size is an estimate the app worked out, so it wears the
// estimate fact (sky). The pace is two facts, and the date part carries the
// meaning: late red, due amber, a rate sky. The count only restates the
// progress line, so it shows only when a hold has taken that line, and the
// row keeps one plain grey.
afterEach(cleanup);

const row = (over: Partial<ProjectRow["project"]["data"]> = {}): ProjectRow => ({
  project: { id: "p1", data: { title: "Remodel Bridge Website", status: "active", due: "2026-09-06", ...over } },
  progress: { done: 3, total: 8, pct: 38 },
  stalled: false,
  lastAt: null,
});

const reach = (): GoalReach => ({ progress: null } as unknown as GoalReach);

function page(r: ProjectRow, pace: PaceParts | null, hold: string | null = null) {
  return render(
    <BiggerPicturePage
      goals={[]}
      reachOfGoal={reach}
      projectRows={[r]}
      sections={[]}
      onAddGoal={() => {}}
      onOpenGoal={() => {}}
      onAddProject={() => {}}
      onOpenProject={() => {}}
      sizeLineOf={() => "About 3h"}
      holdLineOf={() => hold}
      paceLineOf={() => pace}
    />,
  );
}

describe("BiggerPicturePage project row", () => {
  it("draws the size as an estimate fact", () => {
    const { container } = page(row(), null);
    const est = container.querySelector(".proj-row .bp-sub .fact.est");
    expect(est?.textContent).toBe("About 3h");
    // Only the estimate is sky: the line carries no count beside it.
    expect(est!.parentElement!.textContent).toBe("About 3h");
  });

  it("draws the pace's date as its own fact in the key's colour, no baked dot", () => {
    for (const [tone, when] of [["red", "Past its date"], ["warn", "Due tomorrow"], ["est", "About 2 a day from here"], ["date", "Due in 10 days"]] as const) {
      const { container } = page(row(), { count: "5 of 8 Left", when, tone });
      const line = container.querySelector(".proj-row .facts") as HTMLElement;
      expect(line, tone).toBeTruthy();
      const facts = line.querySelectorAll(".fact");
      // The progress line above already says 3 of 8 Done: the count would be
      // a second plain grey restating it.
      expect(facts.length, tone).toBe(1);
      expect(facts[0]!.classList.contains(tone), tone).toBe(true);
      expect(facts[0]!.textContent).toBe(when);
      expect(line.textContent).not.toMatch(/\u00b7/);
      cleanup();
    }
  });

  it("keeps the count as the one grey when a hold has taken the progress line", () => {
    const { container } = page(row(), { count: "5 of 8 Left", when: "Due tomorrow", tone: "warn" }, "On hold until Oct 3");
    const facts = container.querySelectorAll(".proj-row .facts .fact");
    expect([...facts].map((f) => f.className)).toEqual(["fact", "fact warn"]);
    expect([...facts].map((f) => f.textContent)).toEqual(["5 of 8 Left", "Due tomorrow"]);
  });
});
