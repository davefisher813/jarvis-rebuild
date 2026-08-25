// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import HeldTasks, { COLLAPSE_OVER } from "./HeldTasks";

// Dave 2026-08-25: "any tasks within events in the schedule should be able to
// compress", and his pick was collapse OVER THREE. The threshold is the whole
// design, so it is what gets pinned: collapsing everything would hide a single
// task behind a tap for no gain, and collapsing nothing is what he was looking
// at when Deep Work spent 180px listing five things.
//
// The demo build has no routine block that holds four tasks, so the browser
// walk cannot reach this state. These tests are the coverage.

const rows = (n: number) => Array.from({ length: n }, (_, i) => <div className="block-held" key={i}>task {i}</div>);

describe("HeldTasks", () => {
  it("shows one or two held tasks outright", () => {
    for (const n of [1, 2, 3]) {
      const { container, unmount } = render(<HeldTasks count={n}>{rows(n)}</HeldTasks>);
      expect(container.querySelectorAll(".block-held")).toHaveLength(n);
      expect(container.querySelector(".held-toggle"), `${n} should not collapse`).toBeNull();
      unmount();
    }
  });

  it("collapses over three, and says how many are hidden", () => {
    const { container } = render(<HeldTasks count={5}>{rows(5)}</HeldTasks>);
    expect(container.querySelectorAll(".block-held")).toHaveLength(0);
    expect(container.querySelector(".held-toggle")!.textContent).toContain("5 tasks");
  });

  it("opens and closes", () => {
    const { container } = render(<HeldTasks count={5}>{rows(5)}</HeldTasks>);
    const t = container.querySelector(".held-toggle") as HTMLElement;
    fireEvent.click(t);
    expect(container.querySelectorAll(".block-held")).toHaveLength(5);
    expect(container.querySelector(".held-toggle")!.textContent).toContain("Hide");
    fireEvent.click(container.querySelector(".held-toggle") as HTMLElement);
    expect(container.querySelectorAll(".block-held")).toHaveLength(0);
  });

  // It lives inside a row that is itself a button, and that row opens the
  // block's editor. One gesture, one outcome.
  it("its tap does not reach the row behind it", () => {
    let rowTaps = 0;
    const { container } = render(
      <div onClick={() => { rowTaps++; }}><HeldTasks count={5}>{rows(5)}</HeldTasks></div>,
    );
    fireEvent.click(container.querySelector(".held-toggle") as HTMLElement);
    expect(rowTaps).toBe(0);
  });

  it("renders nothing at all when the block holds nothing", () => {
    const { container } = render(<HeldTasks count={0}>{rows(0)}</HeldTasks>);
    expect(container.querySelector(".block-nest")).toBeNull();
  });

  it("says task or tasks correctly", () => {
    const { container } = render(<HeldTasks count={COLLAPSE_OVER + 1} label="event">{rows(4)}</HeldTasks>);
    expect(container.querySelector(".held-toggle")!.textContent).toContain("4 events");
  });
});
