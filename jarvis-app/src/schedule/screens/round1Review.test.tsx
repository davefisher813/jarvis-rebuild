// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SchedulePage from "./SchedulePage";
import DayRow from "./DayRow";
import type { EventItem } from "../types";
import type { PlanBlock } from "../planDay";
import { setCategoryRegistry } from "../../shared/categories";
import { numberCaseViolations } from "../../laws/catalogCheck";

// THE ROUND-1 REVIEW OF THE SCHEDULE (Dave 2026-10-05: "Everything should look PERFECT"). Two passes of real screenshots found the
// day head cutting its count to "5 Prop...", Running Late? and Not Today drawn as capsules inside and under the card, an open
// slot and an offer on a third alignment, and a week whose bars were four different lengths. Each is read off the DOM here (the
// decisions D1, D2, D8) or off the stylesheet where the fix is a measure (the grid, the sky length, the week's one track).

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "family", name: "Family", color: "pink" },
]);

const ev = (id: string, start: string, end?: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, ...(end ? { end } : {}), category: "orgB" } });
const day = {
  year: 2026, month: 4, selected: "2026-05-20", todayDate: "2026-05-20",
  dots: {} as Record<number, string[]>, mode: "day" as const, now: "09:00",
  windowStartMin: 8 * 60, windowEndMin: 21 * 60,
};
const blocks: PlanBlock[] = [
  { taskId: "t1", text: "Reply to Nadia", category: "orgB", start: "14:00", end: "14:30" },
  { taskId: "t2", text: "Pay Ticket", category: "family", start: "15:00", end: "15:30" },
];
const proposed = { blocks, openId: null, onToggle: () => {}, onDuration: () => {}, onDrop: () => {} };

describe("the day head (decisions D1, D2 and D8)", () => {
  it("states its count whole on its own line, never cut to '5 Prop...'", () => {
    const { container } = render(<SchedulePage {...day} dayEvents={[ev("a", "10:00", "11:00")]} proposed={proposed} onPlanDay={() => {}} />);
    const fact = container.querySelector(".sc-dayhead .sc-fact")!;
    expect(fact.textContent).toBe("10h Open\u00b72 Proposed");
    // The count is the head's second line, so the capsules never take its room.
    const css = readFileSync(join(__dirname, "../../styles/ruled.css"), "utf8");
    const rule = /\.ruled \.sc-dayhead \.sc-fact \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/flex:\s*1 0 100%/);
    expect(rule).not.toMatch(/ellipsis|overflow:\s*hidden|nowrap/);
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("holds at most two capsules, and Running Late and Not Today are one overflow, not capsules in or under the card", () => {
    const onRunningLate = vi.fn(), onDismissProposal = vi.fn();
    const { container } = render(
      <SchedulePage {...day} dayEvents={[ev("a", "10:00", "11:00")]} proposed={proposed} onPlanDay={() => {}}
        onRunningLate={onRunningLate} onDismissProposal={onDismissProposal} />,
    );
    const head = container.querySelector(".sc-dayhead")!;
    expect(head.querySelectorAll(".pill-action").length, "Plan My Day and the overflow, nothing else").toBe(2);
    // Nothing inside the day card is a capsule.
    expect(container.querySelector(".sched-card .sched-late, .sched-card .pill-action, .sched-card .row-act")).toBeNull();
    expect(screen.queryByText("Running Late?")).toBeNull();
    fireEvent.click(within(head as HTMLElement).getByRole("button", { name: "More for Today" }));
    const lines = Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
    expect(lines).toEqual(["Running Late", "Not Today", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Not Today" }));
    expect(onDismissProposal).toHaveBeenCalledTimes(1);
  });

  it("Running Late opens the three pushes as a sheet and fires the one picked", () => {
    const onRunningLate = vi.fn();
    const { container } = render(<SchedulePage {...day} dayEvents={[ev("a", "10:00", "11:00")]} onPlanDay={() => {}} onRunningLate={onRunningLate} />);
    fireEvent.click(within(container.querySelector(".sc-dayhead") as HTMLElement).getByRole("button", { name: "More for Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Running Late" }));
    const pushes = Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
    expect(pushes).toEqual(["Push Back 15 Min", "Push Back 30 Min", "Push Back 1h", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Push Back 30 Min" }));
    expect(onRunningLate).toHaveBeenCalledWith(30);
  });

  it("offers no overflow when there is nothing to put behind it", () => {
    const { container } = render(<SchedulePage {...day} now={null} dayEvents={[ev("a", "10:00", "11:00")]} onPlanDay={() => {}} onRunningLate={() => {}} />);
    expect(container.querySelector(".head-more")).toBeNull();
  });
});

describe("the open slot and the offer sit on the row grid", () => {
  it("an open slot leads with its plus, then its time, then its words", () => {
    const { container } = render(<SchedulePage {...day} onPickSlot={() => {}} dayEvents={[ev("a", "10:00", "11:00")]} />);
    const gap = container.querySelector(".sched-gap")!;
    const kids = Array.from(gap.children).map((c) => c.className.split(" ")[0]);
    expect(kids).toEqual(["sched-open-plus", "sched-time", "sched-body"]);
  });

  it("an offer under a block names what it adds, wraps instead of truncating, and carries a short reason", () => {
    const { container } = render(
      <SchedulePage {...day} dayEvents={[ev("a", "10:00", "11:00")]} blendMap={{ a: { text: "call ridgeline about the field", why: "While You Move", onAdd: () => {} } }} />,
    );
    const tuck = container.querySelector(".blend-tuck")!;
    expect(tuck.getAttribute("aria-label")).toBe("Add Call Ridgeline About the Field to A");
    expect(tuck.querySelector(".blend-text")!.className).not.toMatch(/truncate/);
    expect(tuck.querySelector(".blend-why")!.textContent).toBe("While You Move");
  });
});

describe("the week", () => {
  const weekRow = (date: string, d: number, dow: number, openMin: number) => ({ date, day: d, dow, windowS: 7 * 60, windowE: 21 * 60, blocks: [], count: 0, openMin, longest: null });
  const cells = [18, 19, 20, 21, 22, 23, 24].map((d) => ({ date: `2026-05-${d}`, day: d, dow: d - 18, dots: [], isToday: d === 20 }));

  it("says its range with 'to', never a hyphen or a dash", () => {
    const rows = cells.map((c) => weekRow(c.date, c.day, c.dow, 120));
    const { container } = render(<SchedulePage {...day} mode="week" weekCells={cells as never} weekRows={rows} dayEvents={[]} />);
    expect(container.querySelector(".sc-date")!.textContent).toBe("May 18 to 24");
  });

  it("stacks the open time (number over word) so one fixed column keeps every bar the same length", () => {
    const rows = cells.map((c) => weekRow(c.date, c.day, c.dow, 90));
    const { container } = render(<SchedulePage {...day} mode="week" weekCells={cells as never} weekRows={rows} dayEvents={[]} />);
    const open = container.querySelector(".wk-open-stack")!;
    expect(open.className).toContain("wk-open");
    expect(open.textContent).toBe("1h 30m Open");
    const css = readFileSync(join(__dirname, "../../styles/ruled.css"), "utf8");
    expect(css).toMatch(/\.ruled \.wk-open \{[^}]*flex:\s*0 0 var\(--wk-open-w\)/);
    // The clock under the card is measured against the same track: the day column, both gaps and the open column.
    expect(css).toMatch(/\.ruled \.wk-ticks \{[^}]*margin-left: calc\(var\(--s-4\) \+ var\(--s-4\) \+ 34px \+ var\(--s-3\)\)/);
    expect(css).toMatch(/margin-right: calc\(var\(--s-4\) \+ var\(--s-4\) \+ var\(--wk-open-w\) \+ var\(--s-3\)\)/);
  });
});

describe("the grid and the key, read off the stylesheet", () => {
  const css = readFileSync(join(__dirname, "../../styles/ruled.css"), "utf8");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = (sel: string) => {
    const m = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((x) => x[1]!.split(",").some((s) => s.trim() === sel));
    return m.map((x) => x[2]).join(" ");
  };

  it("every row's lead and time are fixed slots, so every title starts at one x", () => {
    expect(css).toMatch(/--sched-lead:\s*24px/);
    expect(css).toMatch(/--sched-time-w:\s*calc\(68px \* var\(--type-scale\)\)/);
    const time = body(".ruled .sched-row:not(.sched-row-bare) > .sched-time");
    expect(time).toMatch(/flex:\s*0 0 var\(--sched-time-w\)/);
    expect(time).toMatch(/width:\s*var\(--sched-time-w\)/);
    const lead = body(".ruled .sched-row:not(.sched-row-bare) > .row-star");
    expect(lead).toMatch(/flex:\s*0 0 var\(--sched-lead\)/);
    // A row with no lead (a protected block) keeps the slot's room.
    expect(body(".ruled .sched-row:not(.sched-row-bare) > .sched-time:first-child")).toMatch(/margin-left:\s*calc\(var\(--sched-lead\) \+ var\(--s-3\)\)/);
    // The star's 44px hit is an expander, not a bigger glyph.
    expect(body(".ruled .sched-row > .row-star::after")).toMatch(/inset:/);
  });

  it("a length is the key's sky estimate, never the brand red that means late or tap", () => {
    const len = body(".ruled .sched-until-btn");
    expect(len).toMatch(/color:\s*var\(--est-ink\)/);
    expect(len).not.toMatch(/--tint|--sys-red|--accent/);
  });

  it("the proposed rail is one 3px dashed line in the area's own colour", () => {
    const rail = body(".ruled .sched-bar.sched-bar-proposed");
    expect(rail).toMatch(/border-style:\s*dashed/);
    expect(rail).toMatch(/border-width:\s*0 0 0 3px/);
  });

  it("the title takes the width and the notes glyph rides one fixed slot at the right edge", () => {
    expect(body(".ruled .sched-title > .sched-t")).toMatch(/flex:\s*1 1 8em/);
    expect(body(".ruled .sched-title")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("a length is one ink wherever it is drawn (decision D4)", () => {
  const e = ev("walk", "10:00", "10:45");
  const row = (props: Record<string, unknown> = {}) =>
    render(<DayRow e={e} conflict={false} isNext={false} isPast={false} now={null} {...props} />);

  it("the tappable length is a button the stylesheet paints sky, and it still says its number", () => {
    const { container } = row({ onSetEnd: () => {} });
    const len = container.querySelector(".sched-until-btn")!;
    expect(len.textContent).toBe("45 Min");
    expect(len.getAttribute("aria-label")).toBe("Change length, currently 45 minutes");
  });

  it("a length that cannot be tapped is the same estimate ink, not a white number beside a red one", () => {
    const { container } = row();
    expect(container.querySelector(".sched-cat .sched-fact .fact.est")!.textContent).toBe("45 Min");
    expect(container.querySelector(".sched-cat b")).toBeNull();
  });
});
