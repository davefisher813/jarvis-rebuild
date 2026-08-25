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

  // ROWS JOIN THE CARDS (2026-08-25, second pass). This first said rows were
  // left alone, which was true and was the bug: the stream is mostly rows, so
  // clamping only the pinned card form left Dave's Heads Up at three heights
  // and the complaint standing.
  it("a row is uniform too, because the stream is mostly rows", () => {
    const { container } = render(<NoticeCard icon={null} title="x" sub="y" form="row" />);
    expect(container.querySelector(".notice-card-uniform")).toBeTruthy();
  });

  // The headliner is retired (see stream.ts), so nothing asks for this form
  // any more. It stays unclamped: whatever still reaches it is not part of
  // the uniform stream and should not be quietly reshaped by it.
  it("leaves the retired headliner form alone", () => {
    const { container } = render(<NoticeCard icon={null} title="x" sub="y" form="headliner" />);
    expect(container.querySelector(".notice-card-uniform")).toBeNull();
  });

  // A card whose sub is not RENDERED gives the title both lines rather than
  // truncating it into one. The row form measures and drops a sub it cannot
  // finish, and reading the prop instead of the outcome left the lead notice
  // with a wasted line and a title cut to 74% of itself.
  it("gives the title both lines when no sub is shown", () => {
    const { container } = render(<NoticeCard icon={null} title="Student template ships first" />);
    expect(container.querySelector(".notice-card-solo")).toBeTruthy();
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
