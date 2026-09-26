// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
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

function page(r: ProjectRow, pace: PaceParts | null, hold: string | null = null, next: string | null = null) {
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
      sizeLineOf={() => "About 3h left"}
      holdLineOf={() => hold}
      paceLineOf={() => pace}
      nextActionTextOf={() => next}
    />,
  );
}

describe("BiggerPicturePage project row", () => {
  it("draws the size as an estimate fact", () => {
    const { container } = page(row(), null);
    const est = container.querySelector(".proj-row .bp-sub .fact.est");
    expect(est?.textContent).toBe("About 3h left");
    // Only the estimate is sky: the line carries no count beside it.
    expect(est!.parentElement!.textContent).toBe("About 3h left");
  });

  // The Next line is drawn as the ruled project row draws it (§AM): an amber
  // NEXT kicker, then the action in full ink, no typed colon.
  it("draws Next as a kicker ahead of the action", () => {
    const { container } = page(row(), null, null, "Call Ridgeline");
    const line = container.querySelector(".proj-row .bp-sub.bp-next") as HTMLElement;
    expect(line).toBeTruthy();
    const k = line.querySelector(".bp-next-k");
    expect(k?.textContent).toBe("Next");
    expect(line.textContent).toBe("Next Call Ridgeline");
    expect(line.textContent).not.toMatch(/:/);
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

  // STALLED IS ITS OWN FACT (§AM, F3): the count stays grey and Stalled is
  // amber, with the stylesheet's dot between them, never one in the string.
  it("draws Stalled as an amber fact beside the count, no baked dot", () => {
    const { container } = page({ ...row(), stalled: true }, null);
    const line = container.querySelector(".proj-row .bp-sub .fact")!.parentElement as HTMLElement;
    const facts = [...line.querySelectorAll(".fact")];
    expect(facts.map((f) => f.className)).toEqual(["fact", "fact warn"]);
    expect(facts.map((f) => f.textContent)).toEqual(["3 of 8 Done", "Stalled"]);
    expect(line.textContent).not.toMatch(/\u00b7/);
  });

  // A row with nothing to say shows nothing (§AK): no "No tasks yet".
  it("says nothing under a project with no tasks", () => {
    const { container } = page({ ...row(), progress: null }, null);
    expect(container.querySelector(".proj-row")!.textContent).not.toMatch(/No tasks yet/);
  });

  it("keeps the count as the one grey when a hold has taken the progress line", () => {
    const { container } = page(row(), { count: "5 of 8 Left", when: "Due tomorrow", tone: "warn" }, "On hold until Oct 3");
    const facts = container.querySelectorAll(".proj-row .facts .fact");
    expect([...facts].map((f) => f.className)).toEqual(["fact", "fact warn"]);
    expect([...facts].map((f) => f.textContent)).toEqual(["5 of 8 Left", "Due tomorrow"]);
  });
});

// THE PROJECTS LENS, BOTH SHAPES (§AK, 2026-09-26): an unstarted project's
// row and card carry its title and nothing under it, never "No tasks yet".
describe("BiggerPicturePage Projects lens, a project with no tasks", () => {
  it("prints no placeholder on the card or on the ruled row", () => {
    const r: ProjectRow = { ...row({ category: "work" }), progress: null };
    const { container } = render(
      <BiggerPicturePage
        lens="projects"
        segments={<div />}
        goals={[]}
        reachOfGoal={reach}
        projectRows={[r]}
        sections={[{ id: "work", name: "Work", color: "blue" }]}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    expect(container.textContent).toContain("Remodel Bridge Website");
    expect(container.textContent).not.toMatch(/No tasks yet/);
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(container.querySelector(".proj-row-ruled")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No tasks yet/);
  });
});

// THE GOALS LENS LOGBOOK (§AM F5, 2026-09-26): a finished goal's line is its
// finish date, drawn as a neutral date, with nothing in it bolded.
describe("BiggerPicturePage Goals lens, a finished goal", () => {
  it("draws the finish date as a .fact.date", () => {
    const g = { id: "g1", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } };
    const { container, getByText } = render(
      <BiggerPicturePage
        lens="goals"
        segments={<div />}
        goals={[g]}
        reachOfGoal={reach}
        projectRows={[]}
        sections={[{ id: "health", name: "Health", color: "green" }]}
        statusOf={() => ({ text: "Done", tone: "good" })}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    fireEvent.click(getByText(/1 Done Goal/i).closest("button")!);
    const meter = container.querySelector(".goal-row-ruled .goal-meter") as HTMLElement;
    expect(meter.querySelector(".fact.date")?.textContent).toBe("Finished September 12");
    expect(meter.querySelector("b")).toBeNull();
  });
});
