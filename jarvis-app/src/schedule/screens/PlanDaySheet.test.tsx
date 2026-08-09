// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PlanDaySheet, { type PlanCandidate, type PlanBlocked } from "./PlanDaySheet";
import { fmtTime } from "../calendar";
import type { DaySizing } from "../daySizing";

function label(hhmm: string) { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }

const TASKS: PlanCandidate[] = [
  { id: "t1", text: "Email vendor", category: "work", suggested: true, overdue: false },
  { id: "t2", text: "Book flights", category: "work", suggested: true, overdue: false },
  { id: "t3", text: "Return package", category: "home", suggested: false, overdue: false },
  { id: "t4", text: "Call dentist", category: "home", suggested: false, overdue: true },
  { id: "t5", text: "File taxes", category: "money", suggested: false, overdue: false },
];

// A busy 9-5 window with nothing on the calendar, so every pick has room
// unless a test says otherwise.
const START = 9 * 60;
const END = 17 * 60;

// None pre-picked, so a test can add picks one at a time from a clean slate
// instead of working around the two suggested tasks TASKS pre-seeds.
const NONE_SUGGESTED = TASKS.map((t) => ({ ...t, suggested: false }));

// The 2026-08-09 fix, at the sheet level: an evening plan with a work-hours
// task shows a real evening slot plus an honest label, never "No room" over
// an open evening. That exact wrong behavior is what made the feature feel
// broken (Dave's screenshot).
describe("PlanDaySheet soft work-hours windows", () => {
  const WORK_TASK: PlanCandidate[] = [
    { id: "w1", text: "Send sponsor recap", category: "work", suggested: false, overdue: false, windowS: 540, windowE: 1020 },
  ];

  it("evening planning spills a work task into the evening, labeled, instead of No room", () => {
    // Planning window 7:00 PM to 11:00 PM; the work window ended at 5:00 PM.
    render(
      <PlanDaySheet events={[]} tasks={WORK_TASK} startMin={1140} endMin={1380} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Send sponsor recap"));
    expect(screen.queryByText("No room")).not.toBeInTheDocument();
    expect(screen.getByText("7:00 PM")).toBeInTheDocument();
    expect(screen.getByText(/Outside its usual work hours/)).toBeInTheDocument();
  });

  it("inside its window there is no label: the preference only speaks when broken", () => {
    render(
      <PlanDaySheet events={[]} tasks={WORK_TASK} startMin={420} endMin={1260} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Send sponsor recap"));
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.queryByText(/Outside its usual work hours/)).not.toBeInTheDocument();
  });
});

describe("PlanDaySheet (redesigned 2026-08-06)", () => {
  it("has no cap on how many tasks can be picked", () => {
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    NONE_SUGGESTED.forEach((t) => fireEvent.click(screen.getByText(t.text)));
    // All five picked and numbered 1-5, nothing silently rejected past three.
    ["1", "2", "3", "4", "5"].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
    expect(screen.getByText("Add these 5")).toBeInTheDocument();
  });

  it("still respects a lighter day's cap from sizing.maxBlocks", () => {
    const light: DaySizing = { light: true, maxBlocks: 2, extraSlackMin: 10, note: "lighter" };
    render(
      <PlanDaySheet events={[]} tasks={TASKS} startMin={START} endMin={END} sizing={light} onCommit={() => {}} onClose={() => {}} />,
    );
    // Two tasks were pre-picked (suggested, capped at maxBlocks); a third tap
    // is a no-op rather than bumping one of the first two out.
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.getByText("Email vendor")).toBeInTheDocument();
    expect(screen.getByText("Book flights")).toBeInTheDocument();
    expect(screen.getByText("Add my two")).toBeInTheDocument();
  });

  it("shows a length stepper per pick that adjusts the duration", () => {
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.getByText("45m")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Return package: longer"));
    expect(screen.getByText("60m")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Return package: shorter"));
    fireEvent.click(screen.getByLabelText("Return package: shorter"));
    expect(screen.getByText("30m")).toBeInTheDocument();
  });

  it("lets a pick's time be set by hand, and offers a way back to Auto", () => {
    render(
      <PlanDaySheet events={[]} tasks={TASKS} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Return package: time"), { target: { value: "13:00" } });
    expect(screen.getByText(label("13:00"))).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Auto"));
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
  });

  it("honors a hand-set time even inside a protected range, and shows protected ranges as context", () => {
    const blocked: PlanBlocked[] = [{ s: 12 * 60, e: 13 * 60, label: "Lunch" }];
    render(
      <PlanDaySheet events={[]} tasks={TASKS} startMin={START} endMin={END} blocked={blocked} onCommit={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/Protected today:/)).toBeInTheDocument();
    expect(screen.getByText(/Lunch/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Return package"));
    // 12:15 falls inside the 12:00-13:00 protected range; a hand-set time
    // overrides it on purpose rather than getting bounced elsewhere.
    fireEvent.change(screen.getByLabelText("Return package: time"), { target: { value: "12:15" } });
    expect(screen.getByText(label("12:15"))).toBeInTheDocument();
  });

  it("routes an auto-placed pick around a protected range by default", () => {
    const blocked: PlanBlocked[] = [{ s: START, e: END, label: "Blocked all day" }];
    // Not suggested, so it starts unpicked (t1/t2 are pre-picked by default
    // and this test wants a clean single toggle-on).
    render(
      <PlanDaySheet events={[]} tasks={[TASKS[2]!]} startMin={START} endMin={END} blocked={blocked} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    // No open time anywhere in the window, so it comes back honestly unplaced
    // rather than overlapping the protected range.
    expect(screen.getByText("No room")).toBeInTheDocument();
  });

  it("commits the planned blocks, including hand-set times, on Add", () => {
    const onCommit = vi.fn();
    render(
      <PlanDaySheet events={[]} tasks={TASKS} startMin={START} endMin={END} onCommit={onCommit} onClose={() => {}} />,
    );
    // t1/t2 are pre-picked (suggested); deselect them so only the one
    // deliberate pick below is in the committed plan.
    fireEvent.click(screen.getByText("Email vendor"));
    fireEvent.click(screen.getByText("Book flights"));
    fireEvent.click(screen.getByText("Return package"));
    fireEvent.change(screen.getByLabelText("Return package: time"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByText(/^Add /));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const blocks = onCommit.mock.calls[0]![0];
    expect(blocks).toEqual([{ taskId: "t3", text: "Return package", category: "home", start: "14:00", end: "14:45" }]);
  });
});

describe("PlanDaySheet Estimate with AI (Brain Personalization Phase 1, 2026-08-06)", () => {
  it("is not shown when there is no onAIPlan", () => {
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.queryByText("Estimate with AI")).not.toBeInTheDocument();
  });

  it("is not shown until at least one task is picked", () => {
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={vi.fn()} onCommit={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByText("Estimate with AI")).not.toBeInTheDocument();
  });

  it("passes the current picks and window, then reorders picks and fills in durations from the result", async () => {
    const onAIPlan = vi.fn().mockResolvedValue([
      { id: "t5", minutes: 90 },
      { id: "t3", minutes: 20 },
    ]);
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={onAIPlan} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package")); // t3, picked first
    fireEvent.click(screen.getByText("File taxes")); // t5, picked second
    fireEvent.click(screen.getByText("Estimate with AI"));

    await screen.findByText("90m");
    expect(onAIPlan).toHaveBeenCalledWith(
      [
        { id: "t3", text: "Return package", category: "home", overdue: false },
        { id: "t5", text: "File taxes", category: "money", overdue: false },
      ],
      START,
      END,
    );
    expect(screen.getByText("20m")).toBeInTheDocument();
    // Reordered by the AI's priority order: File taxes now #1, Return package #2.
    const t3Num = screen.getByText("Return package").closest(".p3-row")?.querySelector(".p3-num");
    const t5Num = screen.getByText("File taxes").closest(".p3-row")?.querySelector(".p3-num");
    expect(t5Num?.textContent).toBe("1");
    expect(t3Num?.textContent).toBe("2");
  });

  it("shows an inline error and leaves existing state alone when the AI call fails", async () => {
    const onAIPlan = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <PlanDaySheet events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={onAIPlan} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    fireEvent.click(screen.getByText("Estimate with AI"));

    await screen.findByText(/Couldn.t reach the AI/);
    // The stepper's default duration is untouched; nothing crashed or cleared.
    expect(screen.getByText("45m")).toBeInTheDocument();
  });
});
