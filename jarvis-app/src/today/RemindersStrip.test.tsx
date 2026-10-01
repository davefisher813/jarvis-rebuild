// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemindersStrip from "./RemindersStrip";
import type { ReminderView } from "../tasks/reminders";

const view = (id: string, time: string, over: Partial<ReminderView> = {}): ReminderView => ({
  id, text: id.replace(/-/g, " "), time, unscheduled: false, paused: false, category: "", done: false, missed: false, snoozed: false, letGo: false, ...over,
});

// THE STRIP (Dave's pass-off, 2026-09-26): the next three by time, then ONE
// red "N Missed" row that opens a sheet where each missed reminder is ticked
// off in one tap. The lead (2026-09-26): that row is the one place a missed
// reminder appears on Today, so the sheet carries the Ask Again the Heads Up
// cards used to.
describe("RemindersStrip: the next three and one Missed row", () => {
  const next = [view("take-meds", "08:00"), view("call-mum", "12:00"), view("water-plants", "18:00")];
  const missed = [view("vitamin-d", "07:00", { missed: true }), view("stretch", "07:30", { missed: true })];

  it("draws the upcoming rows in Title Case and one red count row, never a row per missed reminder", () => {
    const { container } = render(<RemindersStrip items={next} missed={missed} onTick={() => {}} onTickMissed={() => {}} onSnooze={() => {}} />);
    expect(screen.getByText("Take Meds")).toBeInTheDocument();
    expect(container.querySelectorAll(".rem-row:not(.rem-missed-row)")).toHaveLength(3);
    const row = container.querySelector(".rem-missed-row")!;
    expect(row).toHaveTextContent("2 Missed Reminders");
    // The door is named (2026-10-01): "Review" says what the tap does.
    expect(row.querySelector(".rem-missed-go")).toHaveTextContent("Review");
    expect(row.querySelector(".chev")).toBeTruthy();
    expect(screen.queryByText("Vitamin D")).toBeNull();
  });

  it("the Missed row opens the sheet; one tap ticks a reminder; Ask Again is its one capsule", () => {
    const onTickMissed = vi.fn();
    const onAskAgain = vi.fn();
    const { container } = render(<RemindersStrip items={next} missed={missed} onTickMissed={onTickMissed} onAskAgainMissed={onAskAgain} />);
    fireEvent.click(container.querySelector(".rem-missed-row")!);
    expect(screen.getByText("Missed Reminders")).toBeInTheDocument();
    const rows = document.querySelectorAll(".sheet-scrim .rem-tick-row");
    expect(rows).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Ask Again" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Again" })[0]!);
    expect(onAskAgain).toHaveBeenCalledWith("vitamin-d");
    expect(onTickMissed).not.toHaveBeenCalled();
    fireEvent.click(rows[1]!);
    expect(onTickMissed).toHaveBeenCalledWith("stretch");
  });

  it("one missed reminder reads singular and still opens the review sheet", () => {
    const { container } = render(<RemindersStrip items={next} missed={[missed[0]!]} onTickMissed={() => {}} />);
    const row = container.querySelector(".rem-missed-row")!;
    expect(row.querySelector(".rem-missed-n")!.textContent).toBe("1 Missed Reminder");
    expect(row).toHaveAttribute("aria-label", "1 Missed Reminder");
    fireEvent.click(row);
    expect(screen.getByText("Missed Reminders")).toBeInTheDocument();
    expect(document.querySelectorAll(".sheet-scrim .rem-tick-row")).toHaveLength(1);
  });

  it("with nothing missed there is no count row", () => {
    const { container } = render(<RemindersStrip items={next} missed={[]} />);
    expect(container.querySelector(".rem-missed-row")).toBeNull();
  });
});
