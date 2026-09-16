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
  // SPEC MOVED (Catalog V4, 2026-08-18): Brain is a headerless nav list.
  // LIFE_AREAS_TAB_HANDOFF (2026-09-16) retired the "Your Areas" boundary and
  // its category rows entirely: browsing an area moved to Life's Areas tab,
  // so Brain's own list is the eight static rows and nothing else, whether
  // or not the account has categories.
  it("renders the flat nav list, with no areas section at all", () => {
    render(<BrainPage onOpen={() => {}} categories={CATS} />);
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
    expect(screen.getByText("Your Routine")).toBeInTheDocument();
    // Brain no longer shows an areas section (LIFE_AREAS_TAB_HANDOFF): no
    // boundary head, and no category ever renders as a row here, categories
    // passed in or not.
    expect(screen.queryByText("Your Areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    expect(screen.queryByText("Family")).not.toBeInTheDocument();
  });

  // SPEC MOVED (Catalog V4, 2026-08-18): nav rows wear the FILLED brand-red
  // glyph (lib-ico-brand). Since 2026-09-16 that is the only glyph kind this
  // page ever renders: category discs moved to Life's Areas tab.
  it("every row is a filled brand-red nav glyph; no category discs", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const glyphs = container.querySelectorAll(".lib-ico");
    expect(glyphs.length).toBe(8); // the static nav rows only
    expect(container.querySelectorAll(".lib-ico.lib-ico-brand").length).toBe(8);
    expect(container.querySelectorAll(".lib-ico.lib-disc").length).toBe(0);
    expect(container.querySelectorAll('.lib-ico[class*="cat-fg-"]').length).toBe(0);
  });

  it("has no dead-end Setup rows (Onboarding/Backup live in Settings)", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelectorAll(".row-status").length).toBe(0);
    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
    expect(screen.queryByText("Backup")).not.toBeInTheDocument();
  });

  it("fires onOpen for a static row", () => {
    const onOpen = vi.fn();
    render(<BrainPage onOpen={onOpen} categories={CATS} />);
    fireEvent.click(screen.getByText("Contacts"));
    expect(onOpen).toHaveBeenCalledWith("contacts", "Contacts");
  });
});
