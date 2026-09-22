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
  return render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={sections} tab={tab} onTab={noop}
    query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={noop} onSettings={noop} onOpen={noop}
    onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} {...extra} />);
}

describe("RemindersPage", () => {
  it("wears the date and the title, and the four views in one menu, never a second tab bar (2026-09-15)", () => {
    const onTab = vi.fn();
    page("today", { onTab });
    expect(screen.getByText(/September 15/)).toBeInTheDocument();
    expect(screen.queryByText("On Your Radar")).not.toBeInTheDocument();
    expect(screen.queryByText("Take the Next Step")).not.toBeInTheDocument();
    // AMENDED 2026-09-17 (Unified Headers), then 2026-09-18 (Dave: "If you
    // drop down, make the chips drop down so everything is on one row
    // directly across"). The views, their meanings and their order are
    // untouched; they sit in one capsule on the shared header's single
    // control line, with the Area cut beside them.
    expect(screen.getByLabelText("View")).toHaveTextContent("Today");
    expect(document.querySelector(".chip-wrap-row")).toBeNull();
    fireEvent.click(screen.getByLabelText("View"));
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent))
      .toEqual(["Today", "Upcoming", "Routines", "Done"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Upcoming" }));
    expect(onTab).toHaveBeenCalledWith("upcoming");
    // The handoff's own named example: "Replace the large red New Reminder
    // button and separate Search button with a visible search field and a
    // compact, labeled Add control."
    expect(screen.queryByText("New Reminder")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New Reminder")).toHaveTextContent("Add");
    expect(screen.getByPlaceholderText("Search Reminders")).toBeInTheDocument();
  });

  it("a card is the door; the checkbox leads, a time gutter carries today's clock, and one pill answers (row anatomy corrected 2026-09-15, v3)", () => {
    const onOpen = vi.fn(); const onOpenLinked = vi.fn(); const onSnooze = vi.fn(); const onTick = vi.fn();
    page("today", { onOpen, onOpenLinked, onSnooze, onTick });
    expect(screen.getByText("Now")).toBeInTheDocument();
    // Time moved out of the facts line into its own gutter: "9:00" and "AM"
    // render separately rather than as one "Today · 9:00 AM" string.
    expect(screen.getByText("9:00")).toBeInTheDocument();
    expect(screen.getByText("AM")).toBeInTheDocument();
    expect(screen.getAllByText("Today", { selector: ".uchip" }).length).toBeGreaterThan(0);
    // v3: a row already carrying a clock and a Today chip does not also carry
    // its rhythm. That fact was the one that overflowed the line; it stays on
    // the rows with no gutter competing for the room, and in the detail sheet.
    expect(screen.queryByText("Weekdays")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Bridge Planning Before Jarvis"));
    expect(onOpen).toHaveBeenCalledWith("now1");
    // A linked reminder shows its verb, not Snooze — Snooze is still one tap
    // away, in the detail sheet, not on this row.
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith({ type: "task", id: "t1", label: "Bridge Priorities" });
    expect(screen.queryAllByText("Snooze").length).toBe(1); // only later1's row, which has no linked item
    fireEvent.click(screen.getByText("Snooze"));
    expect(onSnooze).toHaveBeenCalledWith("later1");
    fireEvent.click(screen.getByLabelText("Mark Bridge Planning Before Jarvis done"));
    expect(onTick).toHaveBeenCalledWith("now1", true);
  });

  // v3: the row is one line of one height, so the trailing slot holds the
  // one action and nothing else. The options glyph that used to ride beside
  // it opened the same sheet the row already opens, so it is gone rather
  // than restyled; the row itself is still the door to it.
  it("the row carries no options glyph, and the action sits in the row, not under it", () => {
    const onOpen = vi.fn();
    const { container } = page("today", { onOpen });
    expect(screen.queryByLabelText("Options for Follow Up With Alberto")).not.toBeInTheDocument();
    expect(container.querySelector(".rem-card-acts")).toBeNull();
    expect(container.querySelector(".rem-card-top .pill-act")).not.toBeNull();
    fireEvent.click(screen.getByText("Follow Up With Alberto"));
    expect(onOpen).toHaveBeenCalledWith("later1");
  });

  it("Routines offers Resume; Done offers Reopen and Restore", () => {
    const onResume = vi.fn(); const onTick = vi.fn(); const onRestore = vi.fn();
    const r = page("routines", { onResume });
    fireEvent.click(screen.getByText("Resume"));
    expect(onResume).toHaveBeenCalledWith("p1");
    r.unmount();
    page("done", { onTick, onRestore });
    fireEvent.click(screen.getByText("Reopen"));
    expect(onTick).toHaveBeenCalledWith("done1", false);
    fireEvent.click(screen.getByText("Restore"));
    expect(onRestore).toHaveBeenCalledWith("sk1", TUE);
    expect(screen.getByText(/^Skipped · Today/)).toBeInTheDocument();
  });

  it("with nothing in the view, the empty state carries its Add", () => {
    const onNew = vi.fn();
    render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={[]} tab="upcoming" onTab={noop}
      query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={onNew} onSettings={noop} onOpen={noop}
      onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} />);
    expect(screen.getByText("Nothing Coming Up")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add a Reminder"));
    expect(onNew).toHaveBeenCalled();
  });

  // AMENDED 2026-09-17 (Unified Headers): the gear became the options
  // control every page shares, and the search field is always on screen, so
  // there is no toggle left to fire.
  it("options opens settings, the search field is always there, Back goes back", () => {
    const onSettings = vi.fn(); const onQuery = vi.fn(); const onBack = vi.fn();
    page("today", { onSettings, onQuery, chrome: { back: "Today", onBack } });
    fireEvent.click(screen.getByLabelText("Reminders Options"));
    fireEvent.click(screen.getByText("Reminder Settings"));
    expect(onSettings).toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Search Reminders"), { target: { value: "meds" } });
    expect(onQuery).toHaveBeenCalledWith("meds");
    fireEvent.click(screen.getByText("Today", { selector: ".nav-back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
