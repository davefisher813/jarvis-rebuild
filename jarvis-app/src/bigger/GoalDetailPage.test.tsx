// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import GoalDetailPage from "./GoalDetailPage";
import type { Goal } from "../life/types";
import type { GoalReach } from "./reach";
import type { Project } from "../projects/types";

// LIFE-F-27 (2026-09-05): the dropped line promised "The reason is in your
// decisions" whether or not a decision had been written. The drop marks the
// goal even when the decision write came back empty, and then the page sent
// you looking for a record that is not there.

const EMPTY: GoalReach = { filedIds: [], taggedIds: [], openTagged: 0, progress: null };

function view(goal: Goal, projects: Project[] = []) {
  render(
    <GoalDetailPage
      goal={goal}
      reach={EMPTY}
      projects={projects}
      nextActionTextOf={() => null}
      onBack={() => {}}
      onEdit={() => {}}
      onOpenProject={() => {}}
      onAddProject={() => {}}
    />,
  );
}

describe("a dropped goal's line (LIFE-F-27)", () => {
  // §AM (2026-09-26): the date is a small-caps fact of its own and the
  // pointer is the line under it, never joined by a typed middle dot.
  it("points at the decision when there is one", () => {
    view({ id: "g1", data: { title: "Half marathon", state: "on_track", dropped: { on: "2026-08-14", decisionId: "d1" } } });
    expect(screen.getByText("Dropped Aug 14")).toHaveClass("fact", "date");
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(screen.getByText("The Reason Is in Your Decisions")).toBeInTheDocument();
    expect(screen.queryByText(/\u00b7/)).toBeNull();
  });

  it("says only the date when no decision was written", () => {
    view({ id: "g2", data: { title: "Half marathon", state: "on_track", dropped: { on: "2026-08-14" } } });
    expect(screen.getByText("Dropped Aug 14")).toBeInTheDocument();
    expect(screen.queryByText(/reason is in your decisions/)).not.toBeInTheDocument();
  });
});

// C-36 and C-37 (Astra, 2026-09-12).
describe("the goal page's milestones and check-in", () => {
  it("asks how it is going only when nothing can be measured, and says the last answer back", () => {
    const onCheckin = vi.fn();
    render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Build massive recruiting network", state: "on_track" } }}
        reach={EMPTY} projects={[]} health="unmeasured"
        checkin={{ word: "on_track", on: "2026-09-03" }} onCheckin={onCheckin}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.getByText("How Is This Going?")).toBeInTheDocument();
    // The answer is the pressed pill; the line under the pills says when,
    // as a small-caps date (§AM, 2026-09-26).
    expect(screen.getByText("On Track")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Checked In Sep 3")).toHaveClass("fact", "date");
    // Unmeasured is not a status, so the hero draws no "No Measure" (§AK).
    expect(screen.queryByText("No Measure")).toBeNull();
    fireEvent.click(screen.getByText("Behind"));
    expect(onCheckin).toHaveBeenCalledWith("behind");
  });

  it("never asks once a measure exists", () => {
    render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Read 12 books", state: "on_track", measure: { kind: "count", target: 12 } } }}
        reach={EMPTY} projects={[]} health="on_track" onCheckin={() => {}}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.queryByText("How Is This Going?")).toBeNull();
  });

  // AMENDED 2026-10-05 (Dave, locked: no pill on a row; a section-level action
  // lives in the section head). The next milestone's Done pill is gone: the
  // row is the door and carries the same ring every task wears, and Add
  // Milestone is the capsule on the Milestones head.
  it("lists milestones with the next one first and its ring, and adds one from the head", () => {
    const onDone = vi.fn(); const onAdd = vi.fn();
    const { container } = render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Make apartment aesthetic", state: "on_track", measure: { kind: "milestones", items: [
          { id: "a", text: "Pick a paint color", done: "2026-09-01" }, { id: "b", text: "Finish bedroom" }, { id: "c", text: "Hang art in hallway" },
        ] } } }}
        reach={EMPTY} projects={[]} health="on_track" moving={2}
        onMilestoneDone={onDone} onAddMilestone={onAdd}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.getByText("Next Milestone")).toBeInTheDocument();
    // The head says it is next; the row does not say it again (§AK).
    expect(screen.queryByText("Up Next")).toBeNull();
    // A count with no state is white: bold inside its fact (§AM).
    expect(screen.getByText("2 Projects").tagName).toBe("B");
    // No pill anywhere on a row: the next milestone's row is the door, and its tick is the ring.
    expect(container.querySelectorAll(".task-row .pill-act, .row .pill-act")).toHaveLength(0);
    const next = screen.getAllByText("Finish Bedroom")[0]!.closest(".task-row")!;
    fireEvent.click(next);
    expect(onDone).toHaveBeenCalledWith("b", true);
    expect(screen.getAllByRole("checkbox").length).toBe(4);
    // Add Milestone is the capsule on the Milestones head, never a row of the card.
    const add = screen.getByText("Add Milestone");
    expect(add).toHaveClass("see-all", "pill-action");
    expect(add.closest(".sh2")!.querySelector(".t")).toHaveTextContent("Milestones");
    expect(add.closest(".card")).toBeNull();
    fireEvent.click(add);
    fireEvent.change(screen.getByPlaceholderText(/The Next Milestone/), { target: { value: "Buy lamps" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/The Next Milestone/), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Buy lamps");
  });

  it("a goal with no milestones draws the head and its capsule only: no card, no placeholder line", () => {
    const { container } = render(
      <GoalDetailPage
        goal={{ id: "g", data: { title: "Make apartment aesthetic", state: "on_track", measure: { kind: "milestones", items: [] } } }}
        reach={EMPTY} projects={[]} health="on_track" onAddMilestone={() => {}}
        nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      />,
    );
    expect(screen.getByText("Add Milestone")).toBeInTheDocument();
    expect(screen.queryByText("No Milestones Yet")).toBeNull();
    const head = screen.getByText("Add Milestone").closest(".sh2")!;
    expect(head.nextElementSibling?.querySelector(".list-card-ruled") ?? null, "nothing under the head").toBeNull();
    expect(container.querySelectorAll(".row-act")).toHaveLength(0);
  });
});

// THE HERO'S ONE GREY (§AK and §AM, 2026-09-26).
describe("the goal hero", () => {
  const base = { nextActionTextOf: () => null, onBack: () => {}, onEdit: () => {}, onOpenProject: () => {}, onAddProject: () => {} };

  it("draws the pace as the date alone, in the key's colour, not a second grey", () => {
    const { container } = render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Read 12 books", state: "on_track", measure: { kind: "count", target: 12 }, by: "2026-10-01" } }}
        reach={EMPTY} projects={[]} health="behind"
        measure={{ done: 4, target: 12, pct: 33, met: false, line: "4 of 12 Done" }}
        pace={{ when: "Past Its Date", tone: "red" }}
      />,
    );
    expect(screen.getByText("Past Its Date")).toHaveClass("fact", "red");
    expect(container.querySelectorAll(".proj-detail-hero .bp-sub").length).toBe(1);
    expect(container.querySelector(".proj-detail-hero")?.textContent).not.toMatch(/\u00b7/);
  });

  it("a finished goal with no filed record does not say Done under its Done", () => {
    const { container } = render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Get health insurance", state: "achieved" } }}
        reach={EMPTY} projects={[]} health="done"
      />,
    );
    expect(screen.getAllByText("Done").length).toBe(1);
    expect(container.querySelector(".proj-detail-hero .bp-sub")).toBeNull();
  });

  it("a dollar goal with nothing saved says the zero in the amount's own shape", () => {
    render(
      <GoalDetailPage {...base}
        goal={{ id: "g", data: { title: "Emergency fund", state: "on_track", moneyTarget: 2000 } }}
        reach={EMPTY} projects={[]}
      />,
    );
    expect(screen.getByText("$0 of $2,000 Saved")).toBeInTheDocument();
  });
});

// THE CATALOG HARD GATE (Dave 2026-10-05: the grey rectangle round "Add a
// Reminder"), and his locked model: a section-level action lives in the section
// head, never inside a card or at the foot of a list. A goal with no projects
// and a goal with nothing saved have no list to group, so the head and its
// capsule are the section and no card holds nothing but its label.
describe("the goal page: section actions live on the section head", () => {
  const boxesHolding = (label: string) =>
    [...document.querySelectorAll(".card, .list-card-ruled")].filter((c) => c.textContent?.trim() === label);

  it("a goal with no projects puts Add Project on the Projects head, with no box round it", () => {
    view({ id: "g3", data: { title: "Learn Spanish", state: "on_track" } });
    const add = screen.getAllByRole("button", { name: "Add Project" }).find((b) => b.classList.contains("pill-action"))!;
    expect(add.closest(".sh2")!.querySelector(".t")).toHaveTextContent("Projects");
    expect(boxesHolding("Add Project")).toHaveLength(0);
    expect(document.querySelectorAll(".row-act"), "never a row").toHaveLength(0);
  });

  it("a goal with projects keeps the capsule on the head, and the card holds only the rows", () => {
    view({ id: "g5", data: { title: "Learn Spanish", state: "on_track" } }, [{ id: "p1", data: { title: "Duolingo Streak", status: "active", category: "" } }]);
    const add = screen.getByRole("button", { name: "Add Project" });
    expect(add.closest(".sh2")).not.toBeNull();
    expect(add.closest(".list-card-ruled")).toBeNull();
    expect(document.querySelectorAll(".row-act")).toHaveLength(0);
  });

  it("a savings goal puts Add to Savings, and See All, on the Savings head; with nothing saved there is no card", () => {
    const withSaved = (saved: { d: string; amount: number }[]) => (
      <GoalDetailPage
        goal={{ id: "g4", data: { title: "Emergency Fund", state: "on_track", moneyTarget: 1000, saved } }}
        reach={EMPTY} projects={[]} nextActionTextOf={() => null}
        onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}} onAddSavings={() => {}}
      />
    );
    const { unmount } = render(withSaved([]));
    const add0 = screen.getByRole("button", { name: "Add to Savings" });
    expect(add0.closest(".sh2")!.querySelector(".t")).toHaveTextContent("Savings");
    expect(boxesHolding("Add to Savings")).toHaveLength(0);
    expect(screen.queryByText("See All")).toBeNull();
    unmount();
    const many = Array.from({ length: 7 }, (_, i) => ({ d: `2026-0${i + 1}-01`, amount: 10 * (i + 1) }));
    const { container } = render(withSaved(many));
    // The capsule stays on the head with entries, the fold is a capsule beside it, and no row of the card is a capsule.
    expect(screen.getByRole("button", { name: "Add to Savings" }).closest(".sh2")).not.toBeNull();
    expect(screen.getByText("See All").closest(".sh2")).not.toBeNull();
    expect(container.querySelectorAll(".list-card-ruled .row-act, .list-card-ruled .pill-act")).toHaveLength(0);
    fireEvent.click(screen.getByText("See All"));
    expect(screen.getByText("Show Fewer")).toBeInTheDocument();
  });
});

// THE GOAL'S HERO GLYPH WEARS THE GOAL'S TONE (Dave 2026-10-05, the ship-blocker review: it was a flat graphite tile).
describe("the hero glyph's tone", () => {
  it("is the watched area's colour, like the list row, when the goal watches one", async () => {
    const { setCategoryRegistry } = await import("../shared/categories");
    setCategoryRegistry([{ id: "health", name: "Health", color: "green" }]);
    try {
      const { container } = render(<GoalDetailPage goal={{ id: "g1", data: { title: "Run a Half", state: "on_track", tags: ["health"] } }} reach={EMPTY} projects={[]} nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}} />);
      const tile = container.querySelector(".proj-detail-hero .proj-icon")!;
      expect(tile).toHaveClass("cat-bg-green");
      expect(tile).not.toHaveClass("cat-bg-graphite");
    } finally { setCategoryRegistry([]); }
  });

  it("is brand red when it watches no area, never flat grey", () => {
    const { container } = render(<GoalDetailPage goal={{ id: "g2", data: { title: "Learn Spanish", state: "on_track" } }} reach={EMPTY} projects={[]} nextActionTextOf={() => null} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}} />);
    const tile = container.querySelector(".proj-detail-hero .proj-icon")!;
    expect(tile).toHaveClass("cat-bg-brand");
    expect(tile).not.toHaveClass("cat-bg-graphite");
  });
});

// THE GOAL'S PROJECT ROW WRAPS ITS NEXT STEP BEFORE IT CUTS IT (same review): scoped to the goal page, two lines, then an ellipsis.
describe("the goal page's project row next step", () => {
  it("wraps to two lines instead of one ellipsized line, scoped to the goal page only", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src/styles/ruled.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const scoped = css.match(/\.ruled\.goal-ruled \.proj-row-ruled \.r-next-v\s*\{([^}]*)\}/);
    expect(scoped, "a rule scoped to the goal page's project row").not.toBeNull();
    expect(scoped![1]).toMatch(/white-space:\s*normal/);
    expect(scoped![1]).toMatch(/-webkit-line-clamp:\s*2/);
    // The shared one-line form (the Projects lens) is unchanged.
    expect(css.match(/\.ruled \.r-next-v\s*\{([^}]*)\}/)![1]).toMatch(/white-space:\s*nowrap/);
  });

  it("the row on the goal page sits under .goal-ruled so the scope reaches it", () => {
    const p = { id: "p1", data: { title: "Rebuild Calder App", status: "active" } } as Project;
    const { container } = render(<GoalDetailPage goal={{ id: "g3", data: { title: "Ship It", state: "on_track" } }} reach={EMPTY} projects={[p]} nextActionTextOf={() => "draft the coach onboarding email for the launch"} onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}} />);
    const v = container.querySelector(".goal-ruled .proj-row-ruled .r-next-v")!;
    expect(v.textContent).toBe("Draft the Coach Onboarding Email for the Launch");
  });
});
