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

  it("with nothing to plan, the primary is a disabled Plan It", () => {
    render(sheet({ tasks: [] }));
    expect(screen.getByText("Nothing to Plan Yet")).toBeInTheDocument();
    expect(screen.getByText("Plan It")).toBeDisabled();
  });

  it("unpicking everything turns the primary back into Plan It, which replans", () => {
    render(sheet({ tasks: TASKS.slice(0, 1) }));
    fireEvent.click(screen.getByText("Email vendor"));
    const replan = screen.getByText("Plan It");
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

// THE LOAD LINE, TWO FACTS DRAWN APART (§AK/§AM, 2026-09-22). loadLine's own
// unit tests went with loadLine when its logic moved into this sheet's JSX,
// so the three cases they held are pinned here, at the markup: the open time
// is the line's one grey, and whether the picks fit is the fact with a
// meaning, green when it fits and red when it runs over.
describe("the load line", () => {
  it("fits: the picks fact is green and says so", () => {
    render(sheet());
    const fits = document.querySelector(".plan-load .fact.good");
    expect(fits, "a day that fits says it in green").not.toBeNull();
    expect(fits!.textContent).toMatch(/fits/);
    expect(document.querySelector(".plan-load .fact.red")).toBeNull();
  });

  it("over: the picks fact is red, says how far over, and nothing says it fits", () => {
    // Three two-hour picks in a two-hour window: one places, two do not.
    render(sheet({ startMin: 9 * 60, endMin: 11 * 60, seed: { ids: ["t1", "t2", "t3"], minutes: { t1: 120, t2: 120, t3: 120 } } }));
    const over = document.querySelector(".plan-load .fact.red");
    expect(over, "a day that runs over says it in red").not.toBeNull();
    expect(over!.textContent).toMatch(/over/);
    expect(document.querySelector(".plan-load .fact.good")).toBeNull();
    // A pick with nowhere to go says "No room" in its time button's own
    // ink, never a red span inside it: the load line above carries the red.
    const noRoom = screen.getAllByText("No room");
    expect(noRoom.length).toBe(2);
    noRoom.forEach((el) => expect(el).toHaveClass("p3-time-btn"));
    expect(document.querySelector(".p3-row .fact.red")).toBeNull();
  });

  it("nothing picked: only the open time, never a picked or over fact", () => {
    render(sheet({ tasks: TASKS.slice(0, 1) }));
    fireEvent.click(screen.getByText("Email vendor"));
    const line = document.querySelector(".plan-load")!;
    expect(line.querySelectorAll(".fact").length).toBe(1);
    expect(line.textContent).not.toMatch(/picked|over/);
    expect(line.textContent).toMatch(/open/);
  });
});

// ONE GREY UNDER A PICK (§AK V5.2, 2026-09-26). The goal line ("Moves ...")
// and the planner's reason are both plain grey runs, so a picked row draws
// the reason only when it draws no goal line.
describe("a picked row says one grey thing under its name", () => {
  it("the reason shows on a pick with no goal line", () => {
    render(sheet());
    // Book flights follows Email vendor, both work: the planner's reason.
    expect(screen.getByText("Same context as previous pick")).toHaveClass("fact");
  });

  it("the reason stands down when the goal line is drawn", () => {
    const withGoal = TASKS.map((t) => (t.id === "t2" ? { ...t, goal: "Get Fit" } : t));
    render(sheet({ tasks: withGoal }));
    expect(screen.getByText("Moves Get Fit")).toBeInTheDocument();
    expect(screen.queryByText("Same context as previous pick")).toBeNull();
  });
});

// ONE PROPOSED DAY (planning merge, phase 1, 2026-08-22). The sheet used to
// run its own autoSelect on mount, which meant Edit on the drafted card
// opened a SECOND planner and silently discarded the card's plan.
describe("seeded from the standing draft", () => {
  it("opens on the draft's picks, in the draft's order, not its own", () => {
    render(sheet({ seed: { ids: ["t5", "t3"], minutes: { t5: 60, t3: 30 } } }));
    // autoSelect would have led with the suggested t1/t2; the draft wins.
    expect(screen.getByText("File taxes")).toBeInTheDocument();
    expect(screen.getByText("Return package")).toBeInTheDocument();
    const picked = [...document.querySelectorAll(".plan-strip-row, .p3-row.on")].length;
    expect(picked).toBeGreaterThan(0);
  });

  // TIME-DEPENDENT BY NATURE: commit re-places from NOW (the 2026-08-21
  // commit-time floor), so a sandbox clock past 5 PM commits nothing at all
  // and the assertion would fail for a reason that has nothing to do with
  // seeding. The clock is pinned inside the day's own window.
  it("uses the draft's lengths, so what commits matches the card behind it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T06:00:00"));
    const onCommit = vi.fn();
    try {
      render(sheet({ seed: { ids: ["t5"], minutes: { t5: 120 } }, onCommit }));
      fireEvent.click(screen.getByText("Add This One"));
    // 120 minutes from 9:00 ends at 11:00. A re-derived estimate (45m by
    // default) would commit 09:45, so this is the draft's own length.
      expect(onCommit).toHaveBeenCalled();
      const blocks = onCommit.mock.calls[0]![0] as { taskId: string; start: string; end: string }[];
      // 120 minutes from 9:00 ends at 11:00. A re-derived estimate (45m by
      // default) would commit 09:45, so this is the draft's own length.
      expect(blocks.find((b) => b.taskId === "t5")).toMatchObject({ start: "09:00", end: "11:00" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the AI refine stands down on a seeded sheet: the plan was already made", async () => {
    const onAIPlan = vi.fn().mockResolvedValue({ items: [], leanedOn: [] });
    render(sheet({ seed: { ids: ["t1"], minutes: { t1: 45 } }, onAIPlan }));
    await act(async () => { await Promise.resolve(); });
    expect(onAIPlan).not.toHaveBeenCalled();
  });

  it("[edge] no seed: the sheet still plans for itself", async () => {
    const onAIPlan = vi.fn().mockResolvedValue({ items: [], leanedOn: [] });
    render(sheet({ seed: null, onAIPlan }));
    await act(async () => { await Promise.resolve(); });
    expect(onAIPlan).toHaveBeenCalled();
  });

  it("[edge] an empty seed falls back to planning for itself", () => {
    render(sheet({ seed: { ids: [], minutes: {} } }));
    expect(screen.getByText("Email vendor")).toBeInTheDocument();
  });
});

// SCHED-F-02 (2026-09-05): the commit-time "no past placements" floor used to
// key on the today/tomorrow toggle, which only Today passes. The Schedule tab
// is a date picker and never passes it, so every date read as today and a
// Monday plan opened on Sunday afternoon committed blocks pushed past Sunday's
// wall clock while the preview still said 7:00 AM.
describe("the commit-time floor keys on the date, not the toggle", () => {
  const WINDOW = { startMin: 7 * 60, endMin: 21 * 60 };

  it("a future date commits exactly what the preview shows, no target prop", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T15:00:00"));
    const onCommit = vi.fn();
    try {
      render(sheet({ date: "2026-09-06", dayLabel: "Sunday", tasks: TASKS.slice(0, 2), onCommit, ...WINDOW }));
      const preview = [...document.querySelectorAll(".p3-time")].map((e) => e.textContent);
      expect(preview).toEqual([label("07:00"), label("08:10")]);
      fireEvent.click(screen.getByText("Add These 2"));
      const blocks = onCommit.mock.calls[0]![0] as { start: string }[];
      expect(blocks.map((b) => label(b.start))).toEqual(preview);
    } finally {
      vi.useRealTimers();
    }
  });

  it("today still floors at now, with no target prop either", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T15:00:00"));
    const onCommit = vi.fn();
    try {
      render(sheet({ date: "2026-09-05", tasks: TASKS.slice(0, 2), onCommit, ...WINDOW }));
      fireEvent.click(screen.getByText("Add These 2"));
      const blocks = onCommit.mock.calls[0]![0] as { start: string }[];
      expect(blocks.map((b) => b.start)).toEqual(["15:00", "16:10"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// SCHED-F-12 (2026-09-05): "Add These N has no double-tap latch, and the Plan
// It re-plan ignores the chosen cap." Two quick taps ran commitPlan twice
// (two toasts, an Undo that no longer matched the day once the heal sweep
// ran), and after unpicking everything the re-plan seeded by the finish-rate
// cap instead of the one he chose in the monthly report.
describe("the commit fires once, and the re-plan uses his cap", () => {
  it("a fast double-tap on Add These commits once, and the button says so", () => {
    const onCommit = vi.fn();
    render(sheet({ onCommit }));
    const add = screen.getByText("Add These 3");
    fireEvent.click(add);
    expect(add).toHaveTextContent("Adding...");
    fireEvent.click(add);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Plan It after unpicking everything seeds his chosen cap, not the default", () => {
    render(sheet({ chosenCap: 2 }));
    // The seed already respected it.
    expect(document.querySelectorAll(".p3-row.on").length).toBe(2);
    for (const t of ["Email vendor", "Book flights"]) fireEvent.click(screen.getByText(t));
    fireEvent.click(screen.getByText("Plan It"));
    expect(document.querySelectorAll(".p3-row.on").length).toBe(2);
  });
});

// SCHED-F-04 (2026-09-05): "Split It commits two blocks for one task and the
// dedupe sweep deletes the second on the next reload." The sheet collapsed
// both sittings to the same task id at the commit, so the calendar could not
// tell them apart and the one-block-per-task sweep took the afternoon one.
describe("Split It reaches the calendar as two sittings", () => {
  it("commits both blocks, each saying which sitting it is", async () => {
    const long = vi.fn(async (picks: { id: string }[]) => ({
      items: picks.map((p) => ({ id: p.id, minutes: 180 })), leanedOn: [] as string[],
    }));
    const got: { taskId: string; text: string; sitting?: number }[][] = [];
    render(sheet({
      tasks: TASKS.slice(0, 1),
      onAIPlan: long,
      onCommit: (b) => { got.push(b.map((x) => ({ taskId: x.taskId, text: x.text, sitting: x.sitting }))); },
    }));
    await waitFor(() => expect(long).toHaveBeenCalledTimes(1));
    fireEvent.click(document.querySelector(".p3-time-btn")!);
    await waitFor(() => expect(screen.getByText("Split It")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Split It"));
    // The sittings are one white number now (§AM F1), not "2 Sittings · 90m each".
    expect(screen.getByText("2 × 90m")).toBeInTheDocument();
    // Two blocks now, and the button counts blocks.
    fireEvent.click(screen.getByText("Add These 2"));
    expect(got.length).toBe(1);
    expect(got[0]!.map((b) => b.taskId)).toEqual(["t1", "t1"]);
    expect(got[0]!.map((b) => b.sitting)).toEqual([1, 2]);
    expect(got[0]![0]!.text).toContain("(1 of 2)");
  });
});
