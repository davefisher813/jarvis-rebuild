// @vitest-environment jsdom
// THE 2026-10-05 REVIEW OF THE SCHEDULE SHEETS AND THE EVENT PAGE (round 1, real screenshots, dark and light). Each test
// renders the real component and asserts the property the review found broken; every one fails without its fix.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PlanDaySheet, { type PlanCandidate } from "./PlanDaySheet";
import EventSheet from "./EventSheet";
import EventDetailPage from "./EventDetailPage";
import type { EventItem } from "../types";

const css = readFileSync(resolve(__dirname, "../../styles/components.css"), "utf8");
const rule = (selector: string): string => {
  const i = css.indexOf(selector + " {");
  expect(i, selector + " has a rule").toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

const DUE: PlanCandidate[] = [
  { id: "t1", text: "Draft the coach email", category: "work", suggested: true, overdue: false, due: "2026-08-20", goal: "Ship the App Store Launch Before September" },
  { id: "t2", text: "Pay ticket", category: "money", suggested: true, overdue: false, due: "2026-08-20" },
];
const plan = (over: Partial<Parameters<typeof PlanDaySheet>[0]> = {}) => (
  <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={DUE} startMin={9 * 60} endMin={17 * 60} onCommit={() => {}} onClose={() => {}} {...over} />
);

describe("Plan My Day: the question, the picks and the head", () => {
  it("asks 'What Fits Today?' and 'What Fits Tomorrow?' in Title Case", () => {
    const { unmount } = render(plan());
    expect(document.querySelector(".p3-q")!.textContent).toBe("What Fits Today?");
    unmount();
    render(plan({ dayLabel: "Tomorrow", target: "tomorrow" }));
    expect(document.querySelector(".p3-q")!.textContent).toBe("What Fits Tomorrow?");
  });

  it("a pick under the Due Today head does not say Due Today again", () => {
    render(plan());
    expect(screen.getAllByText("Due Today").length).toBe(1); // the group head, once
    expect(document.querySelector(".p3-row .facts")?.textContent ?? "").not.toMatch(/Due Today/);
  });

  it("the Moves line wraps whole instead of truncating mid-word", () => {
    render(plan());
    const moves = screen.getByText(/^Moves Ship the App Store Launch Before September$/);
    expect(moves.className).toContain("bp-sub");
    expect(moves.className).not.toContain("truncate");
  });

  it("Set Your Routine is the one capsule in the sheet's head, not a note under the chips", () => {
    render(plan({ routineConfigured: false, onEditRoutine: () => {} }));
    const cta = screen.getByText("Set Your Routine");
    expect(cta.closest(".grp")).not.toBeNull();
    expect(cta.className).toContain("pill-action");
    expect(cta.closest(".plan-sub")).toBeNull();
    expect(document.querySelectorAll(".plan-sub").length).toBe(0);
  });

  it("a picked row is a tint and a hairline of the key, never a 1.5px ring in the ink", () => {
    const on = rule(".p3-row.on");
    expect(on).not.toMatch(/1\.5px/);
    expect(on).not.toMatch(/--sel-bg/);
    expect(on).toMatch(/inset 0 0 0 1px/);
  });

  it("a picked row's time is the primary ink in both themes, never the tap red that reads as late", () => {
    expect(rule(".p3-row.on .p3-time-btn:not(.placing)")).toMatch(/color: var\(--tx-1\)/);
    expect(rule(".p3-row.on .p3-time-btn.placing")).not.toMatch(/tint/);
  });

  it("the group heads and the chip row take the sheet's gutter and no gutter of their own", () => {
    const r = rule(".p3-list .sh2, .sheet-form > .chip-row");
    expect(r).toMatch(/padding-left: 0/);
    expect(r).toMatch(/padding-right: 0/);
  });
});

describe("sheets are opaque", () => {
  it("a sheet is the surface colour, with no alpha for the page to read through", () => {
    expect(css).toMatch(/\.sheet-scrim > \.card \{ background: var\(--surface-2\);/);
    expect(css).toMatch(/\[data-theme="light"\] \.sheet-scrim > \.card \{ background: var\(--chrome-bg\); \}/);
    expect(css).not.toMatch(/\.sheet-scrim > \.card \{ background: color-mix/);
  });
});

const ev = (over: Partial<EventItem["data"]> = {}): EventItem => ({
  id: "e1",
  data: { title: "morning standup", date: "2026-10-05", start: "08:30", end: "09:00", category: "work", ...over },
});

describe("New Event: one column of values", () => {
  const open = (initial: Record<string, unknown> = {}) =>
    render(<EventSheet mode="new" initial={{ date: "2026-11-09", start: "11:00", end: "12:00", ...initial }} categories={[{ id: "c1", name: "Work", color: "blue" }]} onSave={() => {}} onCancel={() => {}} />);

  it("the date and times are values we draw ('Mon, Nov 9', '11:00 AM'), with the real input riding over them", () => {
    open();
    const vals = Array.from(document.querySelectorAll(".xs-pick-v")).map((n) => n.textContent);
    expect(vals).toEqual(["Mon, Nov 9", "11:00 AM", "12:00 PM"]);
    for (const label of ["Date", "Start", "End"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.className).toContain("xs-pick-in");
      expect(input.closest(".xs-pick")).not.toBeNull();
    }
    expect(css).toMatch(/\.xs-pick-in \{ position: absolute; inset: 0;[^}]*opacity: 0;/);
  });

  it("editing the real input still changes the value that is drawn and saved", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ title: "x", date: "2026-11-09", start: "11:00", end: "12:00" }} categories={[{ id: "c1", name: "Work", color: "blue" }]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "13:30" } });
    expect(document.querySelectorAll(".xs-pick-v")[1]!.textContent).toBe("1:30 PM");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "13:30" });
  });

  it("the placeholder is Title Case", () => {
    open();
    expect(screen.getByPlaceholderText("What's Happening?")).toBeInTheDocument();
  });

  it("Notes is one line with its placeholder right-aligned, growing only once there is text or focus", () => {
    open();
    expect(document.querySelector(".xs-textrow")!.className).toContain("xs-notes");
    expect(css).toMatch(/\.form-sheet \.xs-notes \.xs-textarea \{[^}]*text-align: right/);
    expect(css).toMatch(/\.xs-notes \.xs-textarea:not\(:placeholder-shown\)/);
  });

  it("suggested places are a labelled strip of chips, not three bare rows", () => {
    render(
      <EventSheet mode="new" initial={{ date: "2026-11-09", start: "11:00", end: "12:00" }} categories={[{ id: "c1", name: "Work", color: "blue" }]}
        suggestLocations={() => ["Zoom", "Ridgeline Fields"]} onSave={() => {}} onCancel={() => {}} />,
    );
    const label = screen.getByText("Recent Places");
    const strip = label.closest(".xs-sug")!;
    expect(strip.querySelectorAll(".chip").length).toBe(2);
    expect(strip.querySelector(".chip svg")).not.toBeNull(); // the pin
    expect(Array.from(document.querySelectorAll(".xs-group > .row > .conn-name")).map((n) => n.textContent)).not.toContain("Zoom");
  });

  it("the Training Door says what it does while it is off", () => {
    open();
    expect(screen.getByText("Opens the Gym at Start")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Training door" }));
    expect(screen.queryByText("Opens the Gym at Start")).not.toBeInTheDocument();
  });

  it("when every offered task has the same reason, it is not said under each one", () => {
    const attachTasks = ["Swap quotes", "Reply to Nadia", "Record the demo"].map((text, i) => ({ id: "t" + i, text, category: "c1", done: false }));
    render(
      <EventSheet mode="new" initial={{ title: "Work Session", date: "2026-11-09", start: "11:00", end: "12:00", category: "c1" }}
        categories={[{ id: "c1", name: "Work", color: "blue" }]} attachTasks={attachTasks} onSave={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("Swap Quotes")).toBeInTheDocument();
    expect(document.querySelectorAll(".xs-group .conn-meta").length).toBe(0);
  });

  it("the task chips wrap whole at the card edge instead of clipping", () => {
    expect(css).toMatch(/\.form-sheet \.row\.xs-strip \.chip-row > \.chip \{[^}]*white-space: normal/);
  });
});

describe("the event page", () => {
  const page = (e: EventItem, props: Partial<Parameters<typeof EventDetailPage>[0]> = {}) =>
    render(<EventDetailPage event={e} onBack={() => {}} onEdit={() => {}} {...props} />);

  it("title, day and time share one column, on one facts line, with no page-title stroke", () => {
    page(ev());
    const text = document.querySelector(".ev-head > .ev-text")!;
    expect(text.querySelector(".ev-title")!.textContent).toBe("Morning Standup");
    expect(document.querySelector(".pagehead-title")).toBeNull();
    expect(document.querySelectorAll(".ev-text .facts").length).toBe(1);
    const facts = Array.from(document.querySelectorAll(".ev-text .facts .fact")).map((n) => n.textContent);
    expect(facts).toEqual(["Mon, Oct 5", "8:30 AM", "30 Min"]);
    expect(document.querySelector(".ev-text .facts .fact.est")!.textContent).toBe("30 Min");
    expect(document.querySelector(".ev-head .row-pair")).toBeNull();
    expect(document.querySelector(".row-pair")).toBeNull();
  });

  it("the type tile is the event's sky one, the same as the sheet", () => {
    page(ev());
    expect(document.querySelector(".ev-head .row-ico")!.className).toContain("nav-tile-sky");
  });

  it("Before This with no tasks is the head and one capsule: no box, no square Add Task row", () => {
    page(ev(), { onAddStep: () => {} });
    const head = screen.getByText("Before This").closest(".sh2")!;
    const add = screen.getByText("Add Task");
    expect(head.contains(add)).toBe(true);
    expect(add.className).toContain("pill-action");
    expect(document.querySelector(".row-create")).toBeNull();
    expect(head.nextElementSibling?.querySelector(".list-card-ruled")).toBeNull();
  });

  it("the head's Add Task opens the inline field, and a typed task is added", () => {
    const onAddStep = vi.fn();
    page(ev(), { onAddStep });
    fireEvent.click(screen.getByText("Add Task"));
    const field = screen.getByPlaceholderText("What Has to Happen First");
    fireEvent.change(field, { target: { value: "Print the agenda" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(onAddStep).toHaveBeenCalledWith("Print the agenda");
  });

  it("with tasks the card holds only their rows", () => {
    page(ev(), { onAddStep: () => {}, steps: [{ id: "s1", text: "Print the agenda", done: false }] });
    const card = document.querySelector(".list-card-ruled")!;
    expect(card.querySelectorAll(".row").length).toBe(1);
    expect(card.querySelector(".row-create, .pill-act, .row-act")).toBeNull();
  });

  it("the Area row wears its dot", () => {
    page(ev());
    expect(document.querySelector(".ev-area .cat-dot")).not.toBeNull();
    expect(document.querySelector(".ev-area")!.textContent).toBe("Work");
  });

  it("offers Join for a real meeting link, and Duplicate and Delete only where the flow can do them", () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    page(ev({ url: "https://zoom.us/j/123" }), { onDuplicate, onDelete });
    const join = screen.getByText("Join Meeting") as HTMLAnchorElement;
    expect(join.getAttribute("href")).toBe("https://zoom.us/j/123");
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.click(screen.getByText("Delete Event"));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a repeating event's verb is Skip This Day, not Delete, and there is no Join for a non-link", () => {
    page(ev({ recurrence: "weekly", url: "not a link" }), { onDelete: () => {} });
    expect(screen.getByText("Skip This Day")).toBeInTheDocument();
    expect(screen.queryByText("Delete Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Join Meeting")).not.toBeInTheDocument();
    expect(screen.queryByText("Duplicate")).not.toBeInTheDocument();
  });
});
