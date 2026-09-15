// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemindersPage from "./RemindersPage";
import { pageSections, type PageTab } from "../reminders";
import type { TaskItem } from "../TasksService";
import type { ReminderInfo } from "../../notes/types";

// THE REMINDERS PAGE (push E): the reference's layout on the app's chrome.
const item = (r: ReminderInfo, text: string, id: string, category = ""): TaskItem =>
  ({ id, data: { text, category, done: false, reminder: r } } as TaskItem);
const TUE = "2026-09-15";
const noop = () => {};
const items = [
  item({ time: "09:00", days: [1, 2, 3, 4, 5], linkedItem: { type: "task", id: "t1", label: "Bridge Priorities" } }, "Bridge Planning Before Jarvis", "now1"),
  item({ time: "14:00" }, "Follow Up With Alberto", "later1"),
  item({ time: "07:00", lastDone: TUE }, "Send Practice Details", "done1"),
  item({ time: "07:00", paused: true }, "Stretch", "p1"),
  item({ time: "10:00", skippedDates: [TUE] }, "Log Effort", "sk1"),
];
function page(tab: PageTab, extra: Partial<Parameters<typeof RemindersPage>[0]> = {}) {
  const sections = pageSections(items, tab, TUE, "09:30");
  return render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={sections} tab={tab} onTab={noop} todayCount={2} nextId="now1"
    query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={noop} onSettings={noop} onOpen={noop}
    onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} {...extra} />);
}

describe("RemindersPage", () => {
  it("wears the date, the title, the radar count and the four views", () => {
    page("today");
    expect(screen.getByText(/September 15/)).toBeInTheDocument();
    expect(screen.getByText("On Your Radar")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Your next step is ready.")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Today", "Upcoming", "Routines", "Done"]);
    expect(screen.getByText("New Reminder")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("a card is the door; the verb, Snooze and the ring are its answers", () => {
    const onOpen = vi.fn(); const onOpenLinked = vi.fn(); const onSnooze = vi.fn(); const onTick = vi.fn();
    page("today", { onOpen, onOpenLinked, onSnooze, onTick });
    expect(screen.getByText("Ready Now")).toBeInTheDocument();
    expect(screen.getByText("Today · 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Bridge Planning Before Jarvis"));
    expect(onOpen).toHaveBeenCalledWith("now1");
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith({ type: "task", id: "t1", label: "Bridge Priorities" });
    fireEvent.click(screen.getAllByText("Snooze")[0]!);
    expect(onSnooze).toHaveBeenCalledWith("now1");
    fireEvent.click(screen.getByLabelText("Mark Bridge Planning Before Jarvis done"));
    expect(onTick).toHaveBeenCalledWith("now1", true);
    fireEvent.click(screen.getByLabelText("Options for Follow Up With Alberto"));
    expect(onOpen).toHaveBeenCalledWith("later1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("Take the Next Step opens the next reminder", () => {
    const onOpen = vi.fn();
    page("today", { onOpen });
    fireEvent.click(screen.getByText("Take the Next Step"));
    expect(onOpen).toHaveBeenCalledWith("now1");
  });

  it("Routines offers Resume; Done offers Reopen and Restore", () => {
    const onResume = vi.fn(); const onTick = vi.fn(); const onRestore = vi.fn();
    const r = page("routines", { onResume });
    fireEvent.click(screen.getByText("Resume Reminder"));
    expect(onResume).toHaveBeenCalledWith("p1");
    r.unmount();
    page("done", { onTick, onRestore });
    fireEvent.click(screen.getByText("Reopen Occurrence"));
    expect(onTick).toHaveBeenCalledWith("done1", false);
    fireEvent.click(screen.getByText("Restore Occurrence"));
    expect(onRestore).toHaveBeenCalledWith("sk1", TUE);
    expect(screen.getByText(/^Skipped · Today/)).toBeInTheDocument();
  });

  it("with nothing in the view, the empty state carries its Add", () => {
    const onNew = vi.fn();
    render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={[]} tab="upcoming" onTab={noop} todayCount={0} nextId={null}
      query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={onNew} onSettings={noop} onOpen={noop}
      onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} />);
    expect(screen.getByText("Nothing Here Right Now")).toBeInTheDocument();
    expect(screen.getByText("Space for what comes next.")).toBeInTheDocument();
    expect(screen.getByText("All Clear")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add a Reminder"));
    expect(onNew).toHaveBeenCalled();
  });

  it("the gear opens settings, Search toggles the field, Back goes back", () => {
    const onSettings = vi.fn(); const onSearchToggle = vi.fn(); const onBack = vi.fn();
    page("today", { onSettings, onSearchToggle, chrome: { back: "Today", onBack } });
    fireEvent.click(screen.getByLabelText("Reminder Settings"));
    expect(onSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Search"));
    expect(onSearchToggle).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Today", { selector: ".nav-back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
