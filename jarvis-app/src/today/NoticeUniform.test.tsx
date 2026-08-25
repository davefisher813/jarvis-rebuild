// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NoticeCard from "./NoticeCard";

// Dave 2026-08-25: "Why are the heads up containers different sizes? They
// should all be the size of update workout feature."
//
// jsdom cannot measure a clamp, so this holds the CONTRACT rather than the
// pixels: which cards opt in, which one opts out, and that the opt-out is
// reachable at all. The heights themselves are asserted by the browser walk.

describe("the Heads Up stream is one height", () => {
  it("a card is uniform without being asked", () => {
    const { container } = render(<NoticeCard icon={null} title="Make Apartment Aesthetic" sub="1 Open" />);
    expect(container.querySelector(".notice-card-uniform")).toBeTruthy();
  });

  it("mail opts out, because a sender is any length the world chooses", () => {
    const { container } = render(<NoticeCard icon={null} title="nikestrength" sub="Missing invoice" uniform={false} />);
    expect(container.querySelector(".notice-card-uniform")).toBeNull();
    // Still a card, just not a clamped one.
    expect(container.querySelector(".notice-card")).toBeTruthy();
  });

  // The row and headliner forms have their own line rules and their own
  // measured sub-dropping. Clamping them as well would be a second system
  // fighting the first.
  it("leaves the row and headliner forms alone", () => {
    for (const form of ["row", "headliner"] as const) {
      const { container, unmount } = render(<NoticeCard icon={null} title="x" sub="y" form={form} />);
      expect(container.querySelector(".notice-card-uniform"), form).toBeNull();
      unmount();
    }
  });

  it("keeps the title and the action on one line together", () => {
    const { container } = render(
      <NoticeCard icon={null} title="A Very Long Notice Title That Would Wrap" action={{ label: "Plan Them", onClick: () => {} }} />,
    );
    const row = container.querySelector(".notice-card-uniform .row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector(".pill-act")).toBeTruthy();
    expect(row.querySelector(".conn-name")).toBeTruthy();
  });
});
