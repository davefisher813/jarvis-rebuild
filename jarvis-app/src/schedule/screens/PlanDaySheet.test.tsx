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
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={WORK_TASK} startMin={1140} endMin={1380} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Send sponsor recap"));
    expect(screen.queryByText("No room")).not.toBeInTheDocument();
    // The row's own time slot (the day strip's scale also prints 7:00 PM).
    expect(document.querySelector(".p3-time")!.textContent).toBe("7:00 PM");
    expect(screen.getByText(/Outside its work hours/)).toBeInTheDocument();
  });

  it("draws the day strip: picks, events, and protected time as proportional segments", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today"
        events={[{ id: "e1", data: { title: "Standup", date: "2026-08-09", start: "09:00", end: "09:30", category: "" } }]}
        tasks={WORK_TASK}
        startMin={420} endMin={1260}
        blocked={[{ s: 720, e: 780, label: "Lunch", soft: true }]}
        onCommit={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Send sponsor recap"));
    const bar = document.querySelector(".plan-strip-bar")!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector('[title="Standup"]')).toBeTruthy();
    expect(bar.querySelector('[title="Lunch"]')!.className).toContain("strip-soft");
    expect(bar.querySelector('[title="Send sponsor recap"]')!.className).toContain("strip-pick");
    // Proportions: a 9:00 AM event in a 7 AM-9 PM window starts 1/7 in.
    const standup = bar.querySelector('[title="Standup"]') as HTMLElement;
    expect(parseFloat(standup.style.left)).toBeCloseTo(((540 - 420) / 840) * 100, 1);
  });

  it("tap-to-place: arm a pick's time chip, tap the strip, the pick lands there", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today"
        events={[{ id: "e1", data: { title: "Standup", date: "2026-08-09", start: "09:00", end: "09:30", category: "" } }]}
        tasks={NONE_SUGGESTED} startMin={420} endMin={1260}
        onCommit={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Return package"));
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    fireEvent.click(screen.getByLabelText("Return package: place on the day"));
    expect(screen.getByText(/Tap where/)).toBeInTheDocument();
    const bar = document.querySelector(".plan-strip-bar") as HTMLElement;
    // 7 AM-9 PM window, 840 wide in test pixels: one px per minute.
    bar.getBoundingClientRect = () => ({ left: 0, width: 840, top: 0, right: 840, bottom: 22, height: 22, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(bar, { clientX: 600 }); // minute 1020 = 5:00 PM, snaps clean
    expect((screen.getByLabelText("Return package: time") as HTMLInputElement).value).toBe("17:00");
    expect(screen.queryByText(/Tap where/)).not.toBeInTheDocument();
  });

  it("inside its window there is no label: the preference only speaks when broken", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={WORK_TASK} startMin={420} endMin={1260} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Send sponsor recap"));
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.queryByText(/Outside its usual work hours/)).not.toBeInTheDocument();
  });
});

describe("PlanDaySheet (redesigned 2026-08-06)", () => {
  it("has no cap on how many tasks can be picked", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    NONE_SUGGESTED.forEach((t) => fireEvent.click(screen.getByText(t.text)));
    // All five picked and numbered 1-5, nothing silently rejected past three.
    ["1", "2", "3", "4", "5"].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
    expect(screen.getByText("Add these 5")).toBeInTheDocument();
  });

  it("still respects a lighter day's cap from sizing.maxBlocks", () => {
    const light: DaySizing = { light: true, maxBlocks: 2, extraSlackMin: 10, note: "lighter" };
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={TASKS} startMin={START} endMin={END} sizing={light} onCommit={() => {}} onClose={() => {}} />,
    );
    // Two tasks were pre-picked (suggested, capped at maxBlocks); a third tap
    // is a no-op rather than bumping one of the first two out.
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.getByText("Email vendor")).toBeInTheDocument();
    expect(screen.getByText("Book flights")).toBeInTheDocument();
    expect(screen.getByText("Add my two")).toBeInTheDocument();
  });

  // P6 (Dave 2026-08-20): the stepper became chips. 45m to 2h was five taps.
  it("shows length chips per pick that set the duration in one tap", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    const chip = (m: number) => screen.getByLabelText(`Return package: ${m} minutes`);
    expect(chip(45).className).toContain("chip-on");
    fireEvent.click(chip(120));
    expect(chip(120).className).toContain("chip-on");
    expect(chip(45).className).not.toContain("chip-on");
    fireEvent.click(chip(30));
    expect(chip(30).className).toContain("chip-on");
  });

  it("lets a pick's time be set by hand, and offers a way back to Auto", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={TASKS} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    fireEvent.change(screen.getByLabelText("Return package: time"), { target: { value: "13:00" } });
    expect(screen.getByText(label("13:00"))).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Auto"));
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
  });

  it("honors a hand-set time even inside a protected range, and shows protected ranges as context", () => {
    const blocked: PlanBlocked[] = [{ s: 12 * 60, e: 13 * 60, label: "Lunch" }];
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={TASKS} startMin={START} endMin={END} blocked={blocked} onCommit={() => {}} onClose={() => {}} />,
    );
    // B2 (Dave 2026-08-20): the routine folded to one line. Five rows, three
    // of them telling him when he eats, ate half the sheet.
    expect(screen.queryByText(/Protected · Routed around/)).not.toBeInTheDocument();
    expect(screen.getByText(/Around Lunch/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText(/Protected · Routed around/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Return package"));
    // 12:15 falls inside the 12:00-13:00 protected range; a hand-set time
    // overrides it on purpose rather than getting bounced elsewhere.
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    fireEvent.change(screen.getByLabelText("Return package: time"), { target: { value: "12:15" } });
    expect(screen.getByText(label("12:15"))).toBeInTheDocument();
  });

  it("routes an auto-placed pick around a protected range by default", () => {
    const blocked: PlanBlocked[] = [{ s: START, e: END, label: "Blocked all day" }];
    // Not suggested, so it starts unpicked (t1/t2 are pre-picked by default
    // and this test wants a clean single toggle-on).
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={[TASKS[2]!]} startMin={START} endMin={END} blocked={blocked} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    // No open time anywhere in the window, so it comes back honestly unplaced
    // rather than overlapping the protected range.
    expect(screen.getByText("No room")).toBeInTheDocument();
  });

  it("commits the planned blocks, including hand-set times, on Add", () => {
    const onCommit = vi.fn();
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={TASKS} startMin={START} endMin={END} onCommit={onCommit} onClose={() => {}} />,
    );
    // t1/t2 are pre-picked (suggested); deselect them so only the one
    // deliberate pick below is in the committed plan.
    fireEvent.click(screen.getByText("Email vendor"));
    fireEvent.click(screen.getByText("Book flights"));
    fireEvent.click(screen.getByText("Return package"));
    // Adjusting a pick lives behind its time chip now, so the list stays a
    // list instead of six hundred pixels of chrome (2026-08-20).
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
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
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    expect(screen.queryByText("Re-Estimate Lengths")).not.toBeInTheDocument();
  });

  it("is not shown until at least one task is picked", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={vi.fn()} onCommit={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByText("Re-Estimate Lengths")).not.toBeInTheDocument();
  });

  it("passes the current picks and window, then reorders picks and fills in durations from the result", async () => {
    const onAIPlan = vi.fn().mockResolvedValue([
      { id: "t5", minutes: 90 },
      { id: "t3", minutes: 20 },
    ]);
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={onAIPlan} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package")); // t3, picked first
    fireEvent.click(screen.getByText("File taxes")); // t5, picked second
    fireEvent.click(screen.getByText("Re-Estimate Lengths"));

    await screen.findByText("File taxes");
    expect(onAIPlan).toHaveBeenCalledWith(
      [
        { id: "t3", text: "Return package", category: "home", overdue: false },
        { id: "t5", text: "File taxes", category: "money", overdue: false },
      ],
      START,
      END,
    );
    // The AI's lengths landed: 90 for t5 (a chip can say it), 20 for t3 (no
    // chip can, so the readout does).
    fireEvent.click(screen.getByLabelText("File taxes: adjust"));
    expect(screen.getByLabelText("File taxes: 90 minutes").className).toContain("chip-on");
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    expect(document.querySelector(".plan-dur")!.textContent).toBe("20m");
    // Reordered by the AI's priority order: File taxes now #1, Return package #2.
    const t3Num = screen.getByText("Return package").closest(".p3-row")?.querySelector(".p3-num");
    const t5Num = screen.getByText("File taxes").closest(".p3-row")?.querySelector(".p3-num");
    expect(t5Num?.textContent).toBe("1");
    expect(t3Num?.textContent).toBe("2");
  });

  it("shows an inline error and leaves existing state alone when the AI call fails", async () => {
    const onAIPlan = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today" events={[]} tasks={NONE_SUGGESTED} startMin={START} endMin={END} onAIPlan={onAIPlan} onCommit={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Return package"));
    fireEvent.click(screen.getByText("Re-Estimate Lengths"));

    await screen.findByText(/Couldn.t reach the AI/);
    // The default duration is untouched; nothing crashed or cleared. 45 is a
    // chip, so the chip is the readout.
    fireEvent.click(screen.getByLabelText("Return package: adjust"));
    expect(screen.getByLabelText("Return package: 45 minutes").className).toContain("chip-on");
  });
});

// Focus zones at the sheet level (2026-08-10): a Deep Work block is announced
// as landing space, drawn as an invitation on the strip, and actually pulls
// the pick into it.
describe("PlanDaySheet focus zones", () => {
  const BLOCKED: PlanBlocked[] = [
    { s: 780, e: 1020, label: "Deep Work", kind: "focus" },
    { s: 720, e: 780, label: "Lunch", soft: true },
  ];

  it("announces focus time, pulls the pick into it, and keeps lunch flexible", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today"
        events={[]} tasks={NONE_SUGGESTED} startMin={510} endMin={1410}
        blocked={BLOCKED} onCommit={() => {}} onClose={() => {}}
      />,
    );
    // The fold's own line names the focus zone without being opened.
    expect(screen.getByText(/Picks Land in Deep Work/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show"));
    expect(screen.getByText(/Focus · Picks land here/)).toBeInTheDocument();
    expect(screen.getByText(/Flexible · Used when tight/)).toBeInTheDocument();
    // Deep Work never appears under Protected (there are no hard blocks here).
    expect(screen.queryByText(/Protected · Routed around/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Return package"));
    // The morning is wide open, but the pick lands at 1:00 PM, inside the zone.
    expect(document.querySelector(".p3-time")!.textContent).toBe("1:00 PM");
  });

  it("draws the zone as an outlined invitation, not a wall", () => {
    render(
      <PlanDaySheet date="2026-08-20" dayLabel="Today"
        events={[]} tasks={NONE_SUGGESTED} startMin={510} endMin={1410}
        blocked={BLOCKED} onCommit={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Return package"));
    const bar = document.querySelector(".plan-strip-bar")!;
    expect(bar.querySelector('[title="Deep Work"]')!.className).toContain("strip-focus");
    expect(bar.querySelector('[title="Lunch"]')!.className).toContain("strip-soft");
  });
});
