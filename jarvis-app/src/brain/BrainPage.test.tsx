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

  // SPEC MOVED TWICE. Catalog V4 (2026-08-18) made the rows filled glyphs; the review of 2026-10-05 ("all eight icons are solid
  // brand red, which dilutes the real action colour") gave each destination its OWN tone, because a glyph that only names a
  // place is not a tap target and brand red is for what can be tapped. Since 2026-09-16 these are the only glyphs the page draws:
  // category discs moved to Life's Areas tab.
  it("every row is a filled glyph in its own tone, never the flat brand red; no category discs", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const glyphs = [...container.querySelectorAll(".lib-ico")];
    expect(glyphs.length).toBe(8); // the static nav rows only
    expect(container.querySelectorAll(".lib-ico.lib-ico-brand").length).toBe(0);
    expect(container.querySelectorAll(".lib-ico.lib-disc").length).toBe(0);
    const tones = glyphs.map((g) => [...g.classList].find((c) => c.startsWith("cat-fg-")));
    expect(tones.every((t) => !!t)).toBe(true);
    // Eight destinations, eight hues: a column of one colour is the defect.
    expect(new Set(tones).size).toBe(8);
    expect(tones).not.toContain("cat-fg-red");
  });

  // THE SAME TITLE AS EVERY OTHER LIST (Dave 2026-10-05, the review: Explore titles were about 20px beside 17px in Needs You).
  // A nav row's name is the one .lib-name; the type scale lives in CSS, so the test pins that no row overrides it inline.
  it("every nav row's name is the shared .lib-name with no inline size", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const names = [...container.querySelectorAll(".lib-row .lib-name")] as HTMLElement[];
    expect(names.length).toBe(8);
    expect(names.every((n) => n.getAttribute("style") === null)).toBe(true);
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
