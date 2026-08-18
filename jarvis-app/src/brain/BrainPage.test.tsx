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

  // SPEC MOVED (Catalog V3.1, 2026-08-18): Brain is a library list now, the
  // Apple Music form. Bare colored glyphs (lib-ico + cat-fg-*), no tiles;
  // color still systemic, never grey.
  it("renders every row with a colored (non-grey) library glyph", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const glyphs = container.querySelectorAll(".lib-ico");
    // 5 static rows + 3 category rows (Setup's 2 rows and the Inner Circle /
    // Adversarial rows all removed 2026-08-03)
    expect(glyphs.length).toBe(8);
    expect(container.querySelectorAll(".lib-ico.lib-ico-neutral").length).toBe(0);
    glyphs.forEach((t) => expect(t.className).toMatch(/cat-fg-/));
  });

  it("colors each category glyph with its own slot", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelector(".lib-ico.cat-fg-blue")).toBeTruthy();
    expect(container.querySelector(".lib-ico.cat-fg-pink")).toBeTruthy();
    expect(container.querySelector(".lib-ico.cat-fg-green")).toBeTruthy();
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
      { id: "c4", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("Orgs")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    // every row still present, nothing hidden or merged away
    ["Work", "Elite Squad", "Personal"].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
  });

  // One Money (2026-08-10): Dave, "it looks the same. i only want one money
  // category." A Brain row that just re-opens the Money tab is a second
  // visible door to the same room. Money-kind categories get no row here at
  // all now, whatever they're named; the category still exists, it's just
  // not ALSO a destination in this list. BrainFlow.tsx is what routes a
  // money category to the real Money tab on the rare path that still reaches
  // it (a search deep-link); this list never offers it as a tap target.
  it("drops money-kind categories from the list entirely, regardless of name", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c3", name: "Budget", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c4", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
  });

  it("a lone money-kind category leaves Your Categories empty, not a stray group", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Money", color: "yellow", icon: "wallet", kind: "money" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    // A category exists, but it's money-kind and filtered, so the WHOLE
    // section is gone too: a header over an empty card would be its own
    // small lie ("here's your stuff" over nothing).
    expect(screen.queryByText("Your Categories")).not.toBeInTheDocument();
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
    expect(screen.queryByText("General")).not.toBeInTheDocument();
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
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Whatever", color: "sand", icon: "folder" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Whatever")).toBeInTheDocument();
  });

  it("orders groups Orgs, Health, People, General regardless of input order (Money never appears)", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
      { id: "c2", name: "Health", color: "green", icon: "dumbbell", kind: "health" },
      { id: "c3", name: "Family", color: "pink", icon: "heart", kind: "people" },
      { id: "c4", name: "Money", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c5", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
    ];
    const { container } = render(<BrainPage onOpen={() => {}} categories={cats} />);
    const labels = Array.from(container.querySelectorAll(".cat-group-label")).map((n) => n.textContent);
    expect(labels).toEqual(["Orgs", "Health", "People", "General"]);
  });
});
