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
  // SPEC MOVED (Catalog V4, 2026-08-18): Brain is a headerless nav list with
  // ONE mini-caps boundary label (Your Categories). The three section titles
  // are retired.
  it("renders the flat nav list plus the one Your Categories boundary", () => {
    render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(screen.getByText("Your Categories")).toBeInTheDocument();
    ["Who You Know", "How You Think", "How You Live"].forEach((t) =>
      expect(screen.queryByText(t)).not.toBeInTheDocument(),
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

  // SPEC MOVED (Catalog V4, 2026-08-18): nav rows wear the FILLED brand-red
  // glyph (lib-ico-brand); category rows keep their systemic colors. Never
  // grey, never mixed states in one block.
  it("nav rows are brand red, category rows keep their colors", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const glyphs = container.querySelectorAll(".lib-ico");
    expect(glyphs.length).toBe(10); // 7 nav rows + 3 category rows
    expect(container.querySelectorAll(".lib-ico.lib-ico-brand").length).toBe(7);
    expect(container.querySelectorAll(".lib-ico.lib-ico-neutral").length).toBe(0);
    expect(container.querySelectorAll('.lib-ico[class*="cat-fg-"]').length).toBe(3);
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

describe("BrainPage categories (V4 flat block)", () => {
  // SPEC MOVED (Catalog V4, 2026-08-18): the per-kind sub-labels are retired;
  // kinds only ORDER the flat block. Every row still present.
  it("renders one flat block with no kind sub-labels", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Elite Squad", color: "red", icon: "folder", kind: "org" },
      { id: "c4", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
    ];
    const { container } = render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.queryByText("Orgs")).not.toBeInTheDocument();
    expect(screen.queryByText("General")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".cat-group-label").length).toBe(0);
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
  });

  it("never renders kind labels regardless of mix", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Business", color: "green", icon: "briefcase", kind: "org" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.queryByText("Orgs")).not.toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("a category with no kind set still renders (defaults to plain)", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
      { id: "c2", name: "Whatever", color: "sand", icon: "folder" },
    ];
    render(<BrainPage onOpen={() => {}} categories={cats} />);
    expect(screen.getByText("Whatever")).toBeInTheDocument();
  });

  it("orders the flat block org, health, people, plain (Money never appears)", () => {
    const cats: BrainCategory[] = [
      { id: "c1", name: "Personal", color: "sand", icon: "folder", kind: "plain" },
      { id: "c2", name: "Health", color: "green", icon: "dumbbell", kind: "health" },
      { id: "c3", name: "Family", color: "pink", icon: "heart", kind: "people" },
      { id: "c4", name: "Money", color: "yellow", icon: "wallet", kind: "money" },
      { id: "c5", name: "Work", color: "blue", icon: "briefcase", kind: "org" },
    ];
    const { container } = render(<BrainPage onOpen={() => {}} categories={cats} />);
    const names = Array.from(container.querySelectorAll(".lib-name")).map((n) => n.textContent);
    const catNames = names.filter((n) => ["Personal", "Health", "Family", "Money", "Work"].includes(n ?? ""));
    expect(catNames).toEqual(["Work", "Health", "Family", "Personal"]);
  });
});
