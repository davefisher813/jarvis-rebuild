// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import YourDay, { TICKER_KEY } from "./YourDay";
import type { EventItem } from "../schedule/types";

// Dave 2026-08-25, on a screenshot of a two-row day: "The schedule isn't
// scrolling on its own like a tv guide."
//
// Compressing held tasks (his own pick the day before) made the day FIT, and
// a day that fits does not scroll. His seven rows had become two rows and a
// "5 tasks" line, so the overflow test said "it fits" and the ticker never
// started. One pick switched the other one off.
//
// The fix: the ticker shows the whole day, so the overflow decision is
// measured against THAT and not against the compressed view. These tests
// assert the outcome Dave can see (does it scroll) rather than the mechanism,
// because the mechanism has already changed once and the outcome has not.

const ev = (id: string, start: string): EventItem =>
  ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });

// A block that HOLDS work, which is what pulls tasks inside it.
const deepWork = { s: 780, e: 1020, label: "Deep Work", mode: "holds" };

// jsdom lays nothing out, so every height is 0 and the ticker could never turn
// on in a test. Standing in a height that COUNTS ROWS is the smallest lie that
// still tests the real question: does the decision look at the rows the ticker
// would show, or only at the rows left after collapsing? 60px a row, against a
// 252px window, so five rows overflow and two do not.
const ROW = 60;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.querySelectorAll(".sched-time, .block-held").length * ROW;
    },
  });
  try { localStorage.removeItem(TICKER_KEY); } catch { /* private mode */ }
});

// All five inside 13:00-17:00. An earlier version stepped an hour at a time
// and put two of them past the block's end, so only three nested, which is at
// the threshold and does not collapse at all.
const heldFive = ["13:05", "13:35", "14:05", "14:35", "15:05"].map((t, i) => ev("e" + i, t));

describe("the day that only fits because it is compressed", () => {
  it("scrolls, because the held work counts toward the height", () => {
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    // Compressed, this day is one lock row and a toggle: 60px, well under the
    // window. Expanded it is six rows. Before the fix this rendered as a
    // static two-line list, which is the screenshot Dave sent.
    expect(container.querySelector(".sched-ticker"), "a day this full has to scroll").toBeTruthy();
  });

  it("leaves nothing measured behind in the document", () => {
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    // The twin mounts for one frame and leaves. A twin that stays is a second
    // copy of every row in the page: it broke six unrelated tests on "found
    // multiple elements", and would have shipped that duplication to everyone.
    expect(container.querySelectorAll(".day-measure").length).toBe(0);
  });

  it("a genuinely short day still sits still", () => {
    const { container } = render(
      <YourDay events={[ev("a", "13:05"), ev("b", "18:00")]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    // Two rows, 120px, under the window. Measuring the expanded day must not
    // turn every day into a ticker.
    expect(container.querySelector(".sched-ticker"), "two rows do not need a loop").toBeNull();
  });

  it("the day you can touch is still collapsed", () => {
    // Fixing the scroll must not undo the pick that caused it. Paused is the
    // view you act in, so it stays compressed.
    try { localStorage.setItem(TICKER_KEY, "off"); } catch { /* private mode */ }
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    expect(container.querySelector(".sched-ticker"), "paused means paused").toBeNull();
    const toggle = container.querySelector(".held-toggle");
    expect(toggle, "the visible day keeps its toggle").toBeTruthy();
    expect(toggle!.textContent).toContain("5 tasks");
  });
});
