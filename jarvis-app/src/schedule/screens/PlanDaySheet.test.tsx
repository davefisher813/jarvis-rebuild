// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PlanDaySheet, { type PlanCandidate, type PlanBlocked } from "./PlanDaySheet";
import { fmtTime } from "../calendar";

function label(hhmm: string) { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }

const TASKS: PlanCandidate[] = [
  { id: "t1", text: "Email vendor", category: "work", suggested: true, overdue: false },
  { id: "t2", text: "Book flights", category: "work", suggested: true, overdue: false },
  { id: "t3", text: "Return package", category: "home", suggested: false, overdue: false },
  { id: "t4", text: "Call dentist", category: "home", suggested: false, overdue: true },
  { id: "t5", text: "File taxes", category: "money", suggested: false, overdue: false },
];

const START = 9 * 60;
const END = 17 * 60;

const sheet = (over: Partial<Parameters<typeof PlanDaySheet>[0]> = {}) => (
  <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={TASKS} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} {...over} />
);

// THE 2026-08-22 CONTRACT (Dave: "the plan my day page is the worst thing in
// the app... buttons don't work"). The sheet opens already planned, nothing
// tappable is ever a no-op, and the footer is two buttons.
describe("it opens already planned", () => {
  it("first render is a finished plan with numbered picks, times, and one primary", () => {
    render(sheet());
    // Three picks seeded (default cap), each numbered and placed.
    expect(document.querySelectorAll(".p3-row.on").length).toBe(3);
    expect(screen.getByText("Add These 3")).toBeInTheDocument();
    expect(document.querySelectorAll(".p3-time").length).toBe(3);
    // The quiet line replaces the coach cards.
    expect(document.querySelector(".plan-load")!.textContent).toMatch(/3 picked/);
  });

  it("a single candidate seeds a plan of one, and the primary says so", () => {
    render(sheet({ tasks: [TASKS[0]!] }));
    expect(screen.getByText("Add This One")).toBeInTheDocument();
  });

  it("with nothing to plan, the primary is a disabled Plan It For Me", () => {
    render(sheet({ tasks: [] }));
    expect(screen.getByText("Nothing to plan yet")).toBeInTheDocument();
    expect(screen.getByText("Plan It For Me")).toBeDisabled();
  });

  it("unpicking everything turns the primary back into Plan It For Me, which replans", () => {
    render(sheet({ tasks: TASKS.slice(0, 1) }));
    fireEvent.click(screen.getByText("Email vendor"));
    const replan = screen.getByText("Plan It For Me");
    expect(replan).toBeEnabled();
    fireEvent.click(replan);
    expect(document.querySelectorAll(".p3-row.on").length).toBe(1);
  });
});

describe("no silent caps, no dead chips", () => {
  it("picking past the seeded three just works and the fit line follows", () => {
    render(sheet());
    fireEvent.click(screen.getByText("Call dentist"));
    fireEvent.click(screen.getByText("File taxes"));
    expect(document.querySelectorAll(".p3-row.on").length).toBe(5);
    expect(document.querySelector(".plan-load")!.textContent).toMatch(/5 picked/);
  });

  it("every chip in the header row is a real control", () => {
    render(sheet({ onTarget: () => {} }));
    const chips = document.querySelectorAll(".sheet-form > .chip-row .chip");
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((c) => expect(c.tagName).toBe("BUTTON"));
  });

  it("the end-time chip opens a working Done By control that reshapes the day", () => {
    render(sheet());
    fireEvent.click(screen.getByText("By " + label("17:00")));
    const input = screen.getByLabelText("Done by");
    fireEvent.change(input, { target: { value: "12:00" } });
    expect(screen.getByText("By " + label("12:00"))).toBeInTheDocument();
    // Clearing restores the routine window.
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("By " + label("17:00"))).toBeInTheDocument();
  });
});

describe("adjusting a pick", () => {
  it("length chips set the duration in one tap", () => {
    render(sheet());
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.click(screen.getByLabelText("Email vendor: 90 minutes"));
    // 9:00 + 90m + buffer pushes the second pick past 10:30.
    const times = [...document.querySelectorAll(".p3-time")].map((e) => e.textContent);
    expect(times[1]).toBe(label("10:40"));
  });

  it("a hand-set time is honored and Auto goes back", () => {
    render(sheet());
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.change(screen.getByLabelText("Email vendor: time"), { target: { value: "15:00" } });
    expect(document.querySelector(".p3-time")!.textContent).toBe(label("15:00"));
    fireEvent.click(screen.getByText("Auto"));
    expect(document.querySelector(".p3-time")!.textContent).toBe(label("09:00"));
  });

  it("placing pins the strip so the target is on screen, and a strip tap lands the pick", () => {
    render(sheet({ events: [{ id: "e1", data: { title: "Standup", date: "2026-08-20", start: "11:00", end: "11:30", category: "" } }] }));
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.click(screen.getByLabelText("Email vendor: place on the day"));
    expect(document.querySelector(".strip-pinned")).toBeTruthy();
    const bar = document.querySelector(".plan-strip-bar")!;
    bar.getBoundingClientRect = () => ({ left: 0, width: 480, top: 0, right: 480, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    // Halfway across an 8h window = 1:00 PM.
    fireEvent.click(bar, { clientX: 240 });
    expect(document.querySelector(".p3-time")!.textContent).toBe(label("13:00"));
    // Leaving placing mode unpins.
    expect(document.querySelector(".strip-pinned")).toBeNull();
  });
});

describe("the engine's rules still hold at the sheet level", () => {
  const LUNCH: PlanBlocked[] = [{ s: 12 * 60, e: 13 * 60, label: "Lunch" }];

  it("routes an auto-placed pick around a protected range", () => {
    render(sheet({ tasks: TASKS.slice(0, 1), blocked: LUNCH, startMin: 11 * 60 + 30 }));
    // 45m from 11:30 would cross noon; it lands after lunch instead.
    expect(document.querySelector(".p3-time")!.textContent).toBe(label("13:00"));
  });

  it("honors a hand-set time even inside a protected range", () => {
    render(sheet({ tasks: TASKS.slice(0, 1), blocked: LUNCH }));
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.change(screen.getByLabelText("Email vendor: time"), { target: { value: "12:15" } });
    expect(document.querySelector(".p3-time")!.textContent).toBe(label("12:15"));
  });

  it("evening planning spills a work-hours task into the evening, labeled, instead of No room", () => {
    const work: PlanCandidate[] = [
      { id: "w1", text: "Send sponsor recap", category: "work", suggested: false, overdue: false, windowS: 540, windowE: 1020 },
    ];
    render(sheet({ tasks: work, startMin: 1140, endMin: 1380 }));
    expect(screen.queryByText("No room")).not.toBeInTheDocument();
    expect(document.querySelector(".p3-time")!.textContent).toBe("7:00 PM");
    expect(screen.getByText(/Outside its work hours/)).toBeInTheDocument();
  });

  it("commits the planned blocks, including hand-set times, on Add", () => {
    const got: { taskId: string; start: string }[][] = [];
    render(sheet({ tasks: TASKS.slice(0, 2), onCommit: (b) => { got.push(b.map((x) => ({ taskId: x.taskId, start: x.start }))); } }));
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.change(screen.getByLabelText("Email vendor: time"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByText("Add These 2"));
    expect(got.length).toBe(1);
    const mine = got[0]!.find((b) => b.taskId === "t1");
    expect(mine?.start).toBe("14:00");
  });
});

describe("the AI refine runs in the background", () => {
  it("launches once on mount with the auto picks and fills durations when it lands", async () => {
    const calls: string[][] = [];
    const onAIPlan = vi.fn(async (picks: { id: string }[]) => {
      calls.push(picks.map((p) => p.id));
      return { items: picks.map((p) => ({ id: p.id, minutes: 30 })), leanedOn: ["You finish mornings"] };
    });
    render(sheet({ onAIPlan }));
    await waitFor(() => expect(onAIPlan).toHaveBeenCalledTimes(1));
    expect(calls[0]!.length).toBe(3);
    // 30-minute refits pull the second pick earlier: 9:00 + 30 + 10 buffer.
    await waitFor(() => {
      const times = [...document.querySelectorAll(".p3-time")].map((e) => e.textContent);
      expect(times[1]).toBe(label("09:40"));
    });
    expect(screen.getByText(/Leaning on: You finish mornings/)).toBeInTheDocument();
  });

  it("[edge] a reply never undoes his hands: an explicit length set mid-flight survives", async () => {
    let release: (v: { items: { id: string; minutes: number }[]; leanedOn: string[] }) => void = () => {};
    const onAIPlan = vi.fn(() => new Promise<{ items: { id: string; minutes: number }[]; leanedOn: string[] }>((res) => { release = res; }));
    render(sheet({ onAIPlan }));
    await waitFor(() => expect(onAIPlan).toHaveBeenCalled());
    // While the AI thinks, he sets a length himself.
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    fireEvent.click(screen.getByLabelText("Email vendor: 120 minutes"));
    await act(async () => { release({ items: [{ id: "t1", minutes: 15 }], leanedOn: [] }); });
    const times = [...document.querySelectorAll(".p3-time")].map((e) => e.textContent);
    // Second pick sits after his two hours, not after the AI's fifteen minutes.
    expect(times[1]).toBe(label("11:10"));
  });

  it("[edge] a failed refine shows nothing and changes nothing: learned estimates already stand", async () => {
    const onAIPlan = vi.fn(async () => { throw new Error("down"); });
    render(sheet({ onAIPlan }));
    await waitFor(() => expect(onAIPlan).toHaveBeenCalled());
    expect(document.querySelectorAll(".p3-row.on").length).toBe(3);
    expect(screen.queryByText(/Couldn/)).not.toBeInTheDocument();
  });
});
