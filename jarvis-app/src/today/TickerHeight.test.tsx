// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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

// THE HELD FIVE ARE PROPOSALS NOW (2026-09-21). This fixture used to be five
// committed EVENTS inside Deep Work, which was the shape that hid Dave's 3pm
// job interview; a committed event no longer nests (see nesting.ts). The
// question these tests ask is about the TICKER, not about nesting, so the
// fixture moves to the child that legitimately nests and the subject is
// unchanged: a day that only fits because it is compressed still has to
// scroll, and the paused view still collapses.
const prop = (taskId: string, start: string, end: string) =>
  ({ taskId, text: taskId, start, end, category: "orgB" });
const propFive = ["13:05", "13:35", "14:05", "14:35", "15:05"].map((t, i) =>
  prop("p" + i, t, t.replace(/^(\d\d):(\d\d)$/, (_m, h, mm) => `${h}:${String(Number(mm) + 20).padStart(2, "0")}`)));
const proposedFive = { blocks: propFive, openId: null, onToggle: () => {}, onDuration: () => {}, onDrop: () => {} };

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

  it("a genuinely short day keeps the card and drops the motion", () => {
    const { container } = render(
      <YourDay events={[ev("a", "13:05"), ev("b", "18:00")]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    // AMENDED 2026-09-22 (Dave: "I want the tv guide schedule to render at
    // all times on the home page. It looks awful the other way.") The card
    // is the home page's shape now whether or not the day is long enough to
    // scroll, so this used to assert the card was ABSENT and now asserts it
    // is present and still. Two rows, 120px, under the window: nothing to
    // loop, and a -50% translate across a day shorter than the viewport
    // would slide a gap through the card, which is the "awful".
    const card = container.querySelector(".sched-ticker");
    expect(card, "the card renders at all times").not.toBeNull();
    expect(card!.className, "two rows do not need a loop").toContain("ticker-still");
    expect(container.querySelectorAll(".ticker-track"), "one copy, not two").toHaveLength(1);
  });

  it("the day you can touch is still collapsed", () => {
    // Fixing the scroll must not undo the pick that caused it. Paused is the
    // view you act in, so it stays compressed.
    try { localStorage.setItem(TICKER_KEY, "off"); } catch { /* private mode */ }
    const { container } = render(
      <YourDay events={[]} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}}
        proposed={proposedFive} />,
    );
    expect(container.querySelector(".sched-ticker"), "paused means paused").toBeNull();
    const toggle = container.querySelector(".held-toggle");
    expect(toggle, "the visible day keeps its toggle").toBeTruthy();
    expect(toggle!.textContent).toContain("5 tasks");
    // And the word is accurate now: every one of the five IS a task. It used
    // to count committed events too, which is how a job interview came to be
    // described as one of "5 tasks".
  });
});

// BROWSER-F-16 (2026-09-05): "The ticker auto-scrolls its tappable rows."
// Playwright refused ten of them as unstable targets, and a real finger lands
// on the neighbour just as easily. Touching it holds it still; letting go
// starts it again; the Pause control still turns it off for good.
describe("the ticker holds still under a finger", () => {
  const ticker = (c: HTMLElement) => c.querySelector(".sched-ticker") as HTMLElement;

  it("stops on touch and resumes on release", () => {
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    const t = ticker(container);
    expect(t.className).not.toContain("holding");
    fireEvent.touchStart(t);
    expect(ticker(container).className).toContain("holding");
    fireEvent.touchEnd(t);
    expect(ticker(container).className).not.toContain("holding");
  });

  it("a cancelled touch (a scroll that took over) also lets it go", () => {
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    fireEvent.touchStart(ticker(container));
    fireEvent.touchCancel(ticker(container));
    expect(ticker(container).className).not.toContain("holding");
  });

  it("a tap still stops it for good, which is the sticky pause", () => {
    const { container } = render(
      <YourDay events={heldFive} locked={[deepWork]} now="12:18" nowLabel="12:18" onSeeAll={() => {}} />,
    );
    fireEvent.click(ticker(container));
    expect(container.querySelector(".sched-ticker")).toBeNull();
    expect(localStorage.getItem(TICKER_KEY)).toBe("off");
  });
});
