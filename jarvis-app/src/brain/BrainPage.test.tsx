// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BrainPage, { type BrainCategory } from "./BrainPage";

const CATS: BrainCategory[] = [
  { id: "c1", name: "Work", color: "blue", icon: "briefcase" },
  { id: "c2", name: "Family", color: "pink", icon: "heart" },
  { id: "c3", name: "Health", color: "green", icon: "dumbbell" },
];

describe("BrainPage", () => {
  it("renders the static sections plus a dynamic Your Categories section", () => {
    render(<BrainPage onOpen={() => {}} categories={CATS} />);
    ["Who You Know", "How You Think", "How You Live", "Your Categories"].forEach((t) =>
      expect(screen.getByText(t)).toBeInTheDocument(),
    );
    // Setup was removed 2026-08-03: its rows were Settings wearing a Brain
    // costume, and both dead-ended in "coming soon" screens.
    expect(screen.queryByText("Setup")).not.toBeInTheDocument();
    // The Inner Circle / Adversarial rows were cut the same day: a list only
    // earns a row when a feature acts on membership, and neither did.
    expect(screen.queryByText("Inner Circle")).not.toBeInTheDocument();
    expect(screen.queryByText("Adversarial")).not.toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Your Routine")).toBeInTheDocument();
  });

  it("omits Your Categories when there are none", () => {
    render(<BrainPage onOpen={() => {}} />);
    expect(screen.queryByText("Your Categories")).not.toBeInTheDocument();
  });

  it("renders every row with a colored (non-grey) icon tile", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const tiles = container.querySelectorAll(".sec-ico");
    // 5 static rows + 3 category rows (Setup's 2 rows and the Inner Circle /
    // Adversarial rows all removed 2026-08-03)
    expect(tiles.length).toBe(8);
    expect(container.querySelectorAll(".sec-ico.ico-surface").length).toBe(0);
    tiles.forEach((t) => expect(t.className).toMatch(/ico-blue|ico-accent|ico-good|cat-bg-/));
  });

  it("colors each category tile with its own slot", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelector(".sec-ico.cat-bg-blue")).toBeTruthy();
    expect(container.querySelector(".sec-ico.cat-bg-pink")).toBeTruthy();
    expect(container.querySelector(".sec-ico.cat-bg-green")).toBeTruthy();
  });

  it("has no dead-end Setup rows (Onboarding/Backup live in Settings)", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelectorAll(".row-status").length).toBe(0);
    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
    expect(screen.queryByText("Backup")).not.toBeInTheDocument();
  });

  it("fires onOpen for a static row and a category row", () => {
    const onOpen = vi.fn();
    render(<BrainPage onOpen={onOpen} categories={CATS} />);
    fireEvent.click(screen.getByText("Contacts"));
    expect(onOpen).toHaveBeenCalledWith("contacts", "Contacts");
    fireEvent.click(screen.getByText("Work"));
    expect(onOpen).toHaveBeenCalledWith("c1", "Work");
  });
});

describe("BrainPage category grouping (2026-08-05)", () => {
  it("groups categories by kind with a label per group, when more than one kind is present", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Elite Squad", color: "red", icon: "folder", kind: "org" },
      { id: "c3", name: "Budget", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c4", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("Orgs")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    // every row still present, nothing hidden or merged away
    ["Work", "Elite Squad", "Personal"].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
  });

  it("skips the group label when every category is the same kind, so it never states the obvious", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Business", color: "green", icon: "briefcase", kind: "org" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.queryByText("Orgs")).not.toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("a category with no kind set defaults to General, not dropped", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Money", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c2", name: "Whatever", color: "sand", icon: "folder" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Whatever")).toBeInTheDocument();
  });

  it("orders groups Orgs, Money, Health, People, General regardless of input order", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
      { id: "c2", name: "Health", color: "green", icon: "dumbbell", kind: "health" },
      { id: "c3", name: "Family", color: "pink", icon: "heart", kind: "people" },
      { id: "c4", name: "Money", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c5", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
    ];
    const { container } = render(<BrainPage onOpen={() => {}} categories={cats} />);
    const labels = Array.from(container.querySelectorAll(".cat-group-label")).map((n) => n.textContent);
    expect(labels).toEqual(["Orgs", "Money", "Health", "People", "General"]);
  });
});
