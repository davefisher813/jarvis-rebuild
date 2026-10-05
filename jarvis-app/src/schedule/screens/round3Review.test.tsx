// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SchedulePage from "./SchedulePage";
import DayRow from "./DayRow";
import EventDetailPage from "./EventDetailPage";
import { numberCaseViolations } from "../../laws/catalogCheck";
import { setCategoryRegistry } from "../../shared/categories";
import type { EventItem } from "../types";

// THE ROUND-3 REVIEW OF THE SCHEDULE (Dave 2026-10-05: "Everything should look PERFECT"). The Now marker drew brand red on a thing
// nobody can tap (D4), the notes glyph was a permanent, identical, 31px mark on every event row (no permanent affordance, 44px
// taps), and the event page had an opaque empty head and a title with no air under it (D7, D9).

setCategoryRegistry([{ id: "orgB", name: "Ridgeley", color: "sky" }]);
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() as never; });

const css = ["components.css", "ruled.css"].map((f) => readFileSync(join(__dirname, "../../styles", f), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = [...css.matchAll(new RegExp("(?:^|\\})\\s*" + esc + "\\s*\\{([^}]*)\\}", "g"))].map((m) => m[1]!);
  return hits.join(" ");
};

const ev = (over: Partial<EventItem["data"]> = {}): EventItem =>
  ({ id: "e1", data: { title: "Deep Work", date: "2026-10-05", start: "13:00", end: "14:30", category: "orgB", ...over } }) as EventItem;

describe("the Now marker (D4: brand red is for taps, red only for late)", () => {
  const day = {
    year: 2026, month: 9, selected: "2026-10-05", todayDate: "2026-10-05",
    dots: {} as Record<number, string[]>, mode: "day" as const, now: "12:01",
    windowStartMin: 8 * 60, windowEndMin: 21 * 60,
  };

  it("draws Live in the amber tone, never the red one", () => {
    const { container } = render(<SchedulePage {...day} dayEvents={[ev({ start: "09:00", end: "10:00" }), ev({ start: "13:00", end: "14:00" })].map((e, i) => ({ ...e, id: "e" + i }))} />);
    const live = container.querySelector(".sched-now .fact.st")!;
    expect(live.textContent).toBe("Live");
    expect(live.className).toContain("warn");
    expect(live.className).not.toContain("red");
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("the word and the hairline are the amber ink in both themes, and no light-only red twin is left", () => {
    expect(rule(".ruled .sched-now .w")).toMatch(/color: var\(--warn\)/);
    expect(rule(".ruled .sched-now .l")).toMatch(/background: var\(--warn\)/);
    expect(css).not.toMatch(/\[data-theme="light"\] \.ruled \.sched-now \.w/);
    expect(rule(".ruled .sched-now .w") + rule(".ruled .sched-now .l")).not.toMatch(/sys-red|on-light-red|accent/);
  });
});

describe("the notes glyph on an event row (no permanent affordance, 44px reach)", () => {
  const row = (props: Partial<Parameters<typeof DayRow>[0]> = {}) =>
    render(<DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onNotes={() => {}} {...props} />);

  it("a row with no note draws no glyph at all, so its title keeps the whole column", () => {
    const { container } = row();
    expect(container.querySelector(".sched-notes")).toBeNull();
  });

  it("a row with a note draws one, in the Note's own yellow, never grey or red", () => {
    const { container } = row({ hasNote: true });
    expect(container.querySelector(".sched-notes.on")).not.toBeNull();
    expect(rule(".sched-notes.on")).toMatch(/color: var\(--cat-yellow\)/);
    expect(css).toMatch(/\[data-theme="light"\] \.sched-notes\.on \{[^}]*var\(--cat-ic-yellow\)/);
  });

  it("its reach is 44 wide at least: 15px of glyph plus two 16px pads", () => {
    const m = /\.sched-notes::after \{[^}]*inset: calc\(-1 \* var\(--s-3h\)\) calc\(-1 \* var\(--s-4\)\)/.exec(css);
    expect(m, "the ::after reach is the s-4 pad each side, not -4px -8px").not.toBeNull();
    expect(css).not.toMatch(/\.sched-notes::after \{[^}]*inset: -4px -8px/);
  });
});

describe("the event page", () => {
  const page = (e: EventItem, props: Partial<Parameters<typeof EventDetailPage>[0]> = {}) =>
    render(<EventDetailPage event={e} onBack={() => {}} onEdit={() => {}} {...props} />);

  it("says Prep Tasks, not the opaque Before This, with a warm line and the head's one capsule", () => {
    const { container } = page(ev(), { onAddStep: () => {} });
    expect(screen.queryByText("Before This")).toBeNull();
    const head = screen.getByText("Prep Tasks").closest(".sh2")!;
    expect(head.querySelectorAll(".pill-action").length).toBe(1);
    const empty = container.querySelector(".empty-state")!;
    expect(empty.querySelector(".empty-icon")!.className).toContain("cat-fg-red");
    expect(empty.querySelector(".empty-title")!.textContent).toBe("Nothing to Prep Yet");
    expect(empty.querySelector(".empty-sub")!.textContent).toBe("Add a Task to Get Ready for This");
    expect(empty.querySelector("button, .row-act, .pill-act"), "the capsule is the head's, never a second one in the state").toBeNull();
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("is not drawn at all where a task cannot be added and none hangs here (no bare head)", () => {
    const { container } = page(ev());
    expect(screen.queryByText("Prep Tasks")).toBeNull();
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("drops the empty state the moment there is a task or the field is open", () => {
    const { container } = page(ev(), { onAddStep: () => {}, steps: [{ id: "s1", text: "Print the agenda", done: false }] });
    expect(container.querySelector(".empty-state")).toBeNull();
    expect(screen.getByText("Print the agenda")).toBeInTheDocument();
  });

  it("opening the Add Task field takes the empty state away", () => {
    const { container } = page(ev(), { onAddStep: () => {} });
    fireEvent.click(screen.getByText("Add Task"));
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("the time keeps its AM or PM on one line, and the facts sit one 8pt step under the title", () => {
    page(ev());
    const time = Array.from(document.querySelectorAll(".ev-text .facts .fact")).map((n) => n.textContent)[1]!;
    expect(time).toBe("1:00 PM");
    expect(rule(".ev-title + .facts")).toMatch(/margin-top: var\(--s-2\)/);
  });
});
