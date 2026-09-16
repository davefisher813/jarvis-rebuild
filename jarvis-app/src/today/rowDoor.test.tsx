// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RemindersPage from "../tasks/screens/RemindersPage";
import { pageSections } from "../tasks/reminders";
import type { TaskItem } from "../tasks/TasksService";
import type { ReminderInfo } from "../notes/types";

vi.mock("../events", () => ({ emit: vi.fn() }));

// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows clickable").
//
// This rode on Other Good Choices until that sheet was deleted (2026-09-16,
// "just don't put a button"). The law is rowDoor's, not that sheet's, so it
// moved to a row that is still on the page and has the same anatomy the law
// is about: a row that opens, with its own pill inside it that must NOT open
// it. A reminder row is that row.
const TUE = "2026-09-15";
const noop = () => {};
const item = (r: ReminderInfo, text: string, id: string): TaskItem =>
  ({ id, data: { text, category: "", done: false, reminder: r } } as TaskItem);

function page(extra: Partial<Parameters<typeof RemindersPage>[0]> = {}) {
  const items = [item({ time: "14:00" }, "Call the bank", "t1")];
  const sections = pageSections(items, "today", TUE, "09:30");
  return render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={sections} tab="today" onTab={noop}
    query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={noop} onSettings={noop}
    onOpen={noop} onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} {...extra} />);
}

describe("row door", () => {
  afterEach(cleanup);

  it("opens the task from anywhere on the row, and the pill keeps its own verb", () => {
    const onOpen = vi.fn();
    const onSnooze = vi.fn();
    page({ onOpen, onSnooze });
    fireEvent.click(screen.getByText("Call the bank"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    // The facts line is as much the door as the title is.
    fireEvent.click(screen.getByText("Today", { selector: ".uchip" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    // The pill inside it is its own control and does not open the row.
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    expect(onSnooze).toHaveBeenCalledWith("t1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("answers Enter on the row, but not Enter on the pill inside it", () => {
    const onOpen = vi.fn();
    const { container } = page({ onOpen });
    fireEvent.keyDown(screen.getByRole("button", { name: "Snooze" }), { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(container.querySelector(".rem-card") as HTMLElement, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("t1");
  });
});
