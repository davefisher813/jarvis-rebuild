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
// is about: a row that opens, with its own control inside it that must NOT open
// it. A reminder row is that row.
//
// AMENDED (Dave 2026-10-05, locked: clean rows, no pills). The row's own control
// was a Snooze capsule on every open row. It is gone: the verb is the swipe tray
// and the long-press menu, and a row whose moment has come (due within ten
// minutes, or late) shows it once as RowCtxAction, one quiet word (`.row-ctx`).
// What the law holds is unchanged: the row is the door, and the control inside it
// keeps its own verb and its own Enter. What it now also holds: no pill is drawn
// on the row, and a future reminder draws no verb at all.
const TUE = "2026-09-15";
const noop = () => {};
const item = (r: ReminderInfo, text: string, id: string): TaskItem =>
  ({ id, data: { text, category: "", done: false, reminder: r } } as TaskItem);

/** `now` is the clock the page reads: 13:55 puts the 14:00 reminder inside its ten minutes, 09:30 leaves it in the future. */
function page(now: string, extra: Partial<Parameters<typeof RemindersPage>[0]> = {}) {
  const items = [item({ time: "14:00" }, "Call the bank", "t1")];
  const sections = pageSections(items, "today", TUE, "09:30");
  return render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={sections} tab="today" onTab={noop}
    query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} now={now} onNew={noop} onSettings={noop}
    onOpen={noop} onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} {...extra} />);
}

describe("row door", () => {
  afterEach(cleanup);

  it("opens the task from anywhere on the row, and the quiet verb keeps its own", () => {
    const onOpen = vi.fn();
    const onSnooze = vi.fn();
    const { container } = page("13:55", { onOpen, onSnooze });
    fireEvent.click(screen.getByText("Call the Bank"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    // The facts line is as much the door as the title is.
    fireEvent.click(screen.getByText("Today", { selector: ".uchip" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    // The moment has come, so the row shows its one verb as a quiet word, not a capsule.
    const quiet = container.querySelector(".row-ctx") as HTMLElement;
    expect(quiet, "a row whose moment has come shows its verb").not.toBeNull();
    expect(quiet.textContent).toBe("Snooze");
    expect(container.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action"), "and no capsule anywhere on the row").toBeNull();
    // That verb is its own control and does not open the row.
    fireEvent.click(quiet);
    expect(onSnooze).toHaveBeenCalledWith("t1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("a future reminder is clean: no verb on the row, and Snooze is still the swipe", () => {
    const onSnooze = vi.fn();
    const { container } = page("09:30", { onSnooze });
    expect(container.querySelector(".row-ctx"), "nothing is due, so the row says nothing").toBeNull();
    expect(container.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    // The verb lives in the swipe tray (88px behind the row), named for the record it acts on.
    const tray = container.querySelector(".task-swipe .task-snooze") as HTMLElement;
    expect(tray, "swipe left reveals Snooze").not.toBeNull();
    expect(tray.getAttribute("aria-label")).toBe("Snooze Call the Bank");
    fireEvent.click(tray);
    expect(onSnooze).toHaveBeenCalledWith("t1");
  });

  it("answers Enter on the row, but not Enter on the quiet verb inside it", () => {
    const onOpen = vi.fn();
    const { container } = page("13:55", { onOpen });
    fireEvent.keyDown(container.querySelector(".row-ctx") as HTMLElement, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(container.querySelector(".rem-card") as HTMLElement, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("t1");
  });
});
