// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemindersPage from "./RemindersPage";
import { setCategoryRegistry } from "../../shared/categories";
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
  item({ time: "14:00" }, "Follow Up with Alberto", "later1"),
  item({ time: "07:00", lastDone: TUE }, "Send Practice Details", "done1"),
  item({ time: "07:00", paused: true }, "Stretch", "p1"),
  item({ time: "10:00", skippedDates: [TUE] }, "Log Effort", "sk1"),
];
function page(tab: PageTab, extra: Partial<Parameters<typeof RemindersPage>[0]> = {}, list: TaskItem[] = items) {
  const sections = pageSections(list, tab, TUE, "09:30");
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

  // AMENDED 2026-10-05 (Dave, locked: "Clean rows, no pills anywhere"). The
  // pill is gone from the row. Tap opens the sheet; swipe left is the row's one
  // verb (Snooze, or the linked record's own); swipe right completes.
  it("a card is the door; the checkbox leads, a time gutter carries today's clock, and no pill answers", () => {
    const onOpen = vi.fn(); const onOpenLinked = vi.fn(); const onSnooze = vi.fn(); const onTick = vi.fn();
    const { container } = page("today", { onOpen, onOpenLinked, onSnooze, onTick });
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
    expect(container.querySelectorAll(".pill-act, .row-act"), "no capsule on any row").toHaveLength(0);
    // Swipe left is Snooze on a timed reminder, Delete beside it when the flow can delete; the tray names the record.
    fireEvent.click(screen.getByLabelText("Snooze Follow Up with Alberto"));
    expect(onSnooze).toHaveBeenCalledWith("later1");
    fireEvent.click(screen.getByLabelText("Mark Bridge Planning Before Jarvis done"));
    expect(onTick).toHaveBeenCalledWith("now1", true);
  });

  // v3: the row is one line of one height. The options glyph that used to ride
  // in its trailing slot opened the same sheet the row already opens, so it is
  // gone rather than restyled; the row itself is still the door to it.
  it("the row carries no options glyph and no action in its trailing slot", () => {
    const onOpen = vi.fn();
    const { container } = page("today", { onOpen });
    expect(screen.queryByLabelText("Options for Follow Up with Alberto")).not.toBeInTheDocument();
    expect(container.querySelector(".rem-card-acts")).toBeNull();
    expect(container.querySelector(".rem-card-top button:not(.cb)")).toBeNull();
    fireEvent.click(screen.getByText("Follow Up with Alberto"));
    expect(onOpen).toHaveBeenCalledWith("later1");
  });

  // THE ROW'S ONE VERB, BY STATE (ROW-ACTIONS-SPEC section 1): the first button
  // in the tray is the swipe-left action.
  it("swipe left is the row's one verb for its state: Snooze, the linked verb, Resume, Reopen, Restore", () => {
    const trayOf = (name: string) => [...screen.getByText(name).closest(".task-swipe")!.querySelectorAll(":scope > button")].map((b) => b.textContent);
    const a = page("today", { onOpenLinked: noop, onDelete: noop });
    expect(trayOf("Follow Up with Alberto"), "a timed reminder").toEqual(["Snooze", "Delete"]);
    expect(trayOf("Bridge Planning Before Jarvis"), "timed wins; the linked verb is in its sheet").toEqual(["Snooze", "Delete"]);
    a.unmount();
    const b = page("routines", { onDelete: noop });
    expect(trayOf("Stretch"), "paused").toEqual(["Resume", "Delete"]);
    b.unmount();
    page("done", { onDelete: noop });
    expect(trayOf("Send Practice Details"), "done").toEqual(["Reopen", "Delete"]);
    expect(trayOf("Log Effort"), "skipped").toEqual(["Restore", "Delete"]);
    // A done row has nothing to complete: no leading rail.
    expect(screen.getByText("Send Practice Details").closest(".task-swipe")!.querySelector(".task-done-rail")).toBeNull();
  });

  // CONTEXTUAL SURFACING (Dave 2026-10-05): the right action appears exactly
  // when it is wanted. A reminder due within ten minutes, or already late,
  // shows Snooze on the row as one quiet word; a future one stays clean.
  it("surfaces Snooze on the row only once its moment has come", () => {
    const onSnooze = vi.fn();
    const r = page("today", { onSnooze, now: "09:00" });
    // 09:00 is due now at 09:00; 14:00 is hours away.
    const ctx = [...document.querySelectorAll(".row-ctx")];
    expect(ctx.map((c) => c.closest(".rem-card")!.querySelector(".rem-card-title")!.textContent)).toEqual(["Bridge Planning Before Jarvis"]);
    expect(ctx[0]).toHaveTextContent("Snooze");
    expect(document.querySelector(".pill-act")).toBeNull();
    fireEvent.click(ctx[0]!);
    expect(onSnooze).toHaveBeenCalledWith("now1");
    r.unmount();
    // Earlier in the morning nothing has come: both rows are clean.
    page("today", { now: "07:00" });
    expect(document.querySelectorAll(".row-ctx")).toHaveLength(0);
  });

  it("a row with no clock claims no moment", () => {
    page("today");
    expect(document.querySelectorAll(".row-ctx")).toHaveLength(0);
  });

  // THE LONG PRESS IS THE CONTEXT MENU (never the only way to anything essential).
  it("a right-click or hold opens the menu: the verb, Done, Details, Delete", () => {
    const onDelete = vi.fn();
    page("today", { onDelete });
    fireEvent.contextMenu(screen.getByText("Follow Up with Alberto"));
    const sheet = document.querySelector(".action-sheet")!;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Snooze", "Done", "Details", "Delete"]);
    fireEvent.click(screen.getByText("Delete", { selector: ".action-sheet button" }));
    expect(onDelete).toHaveBeenCalledWith("later1");
  });

  it("Routines offers Resume; Done offers Reopen and Restore", () => {
    const onResume = vi.fn(); const onTick = vi.fn(); const onRestore = vi.fn();
    const r = page("routines", { onResume });
    fireEvent.click(screen.getByLabelText("Resume Stretch"));
    expect(onResume).toHaveBeenCalledWith("p1");
    r.unmount();
    page("done", { onTick, onRestore });
    fireEvent.click(screen.getByLabelText("Reopen Send Practice Details"));
    expect(onTick).toHaveBeenCalledWith("done1", false);
    fireEvent.click(screen.getByLabelText("Restore Log Effort"));
    expect(onRestore).toHaveBeenCalledWith("sk1", TUE);
    // AMENDED 2026-09-26 (§AM): "Skipped" is the state word, not a prefix
    // baked into the phrase with its own middot.
    expect(screen.getByText("Skipped", { selector: ".fact.st.gray" })).toBeInTheDocument();
    expect(screen.queryByText(/Skipped ·/)).not.toBeInTheDocument();
  });

  // §AM F5 (2026-09-26): a done or skipped occurrence of a daily reminder
  // said "Today · 7:00 AM" and "Every Day" in the same plain grey. The date
  // and the clock are small-caps facts now, a skipped row leads with its
  // state word, and the rhythm is the row's one grey.
  it("in the Done view a daily reminder's date and clock are neutral date facts, and the rhythm is the one grey", () => {
    page("done");
    const facts = (name: string) => [...screen.getByText(name).closest(".rem-card")!.querySelectorAll(".facts > .fact")]
      .map((f) => ({ cls: f.className, text: f.textContent }));
    expect(facts("Send Practice Details")).toEqual([
      { cls: "fact date", text: "Today" },
      { cls: "fact date", text: "7:00 AM" },
      { cls: "fact", text: "Every Day" },
    ]);
    expect(facts("Log Effort")).toEqual([
      { cls: "fact st gray", text: "Skipped" },
      { cls: "fact date", text: "Today" },
      { cls: "fact date", text: "10:00 AM" },
      { cls: "fact", text: "Every Day" },
    ]);
    // No middot is baked into any fact on either row: the line draws them.
    for (const f of document.querySelectorAll(".rem-card .facts > .fact")) expect(f.textContent).not.toMatch(/·/);
  });

  // §AM F5 (2026-09-26): a neutral future date on a row is small caps, the
  // .fact.date primitive, never the row's grey a second time. And "Paused" is
  // not one of the closed state words, so a paused row spends its one grey on
  // that word and carries no rhythm beside it.
  it("a future date is the neutral date fact, and a paused row carries no rhythm", () => {
    const thu = item({ time: "08:00", days: [4] }, "Water the Plants", "thu1");
    const r = page("upcoming", {}, [thu]);
    const facts = screen.getByText("Water the Plants").closest(".rem-card")!.querySelector(".facts")!;
    const date = facts.querySelector(".fact")!;
    expect(date).toHaveClass("date");
    expect(date).not.toHaveClass("later");
    expect(date).toHaveTextContent(/17/);
    r.unmount();
    // The date wears the shared reminder window (dayTone, §AM R8): tomorrow
    // is due, so amber, the same as a mail task or a promise due tomorrow.
    const wed = item({ time: "08:00", days: [3] }, "Take Out the Bins", "wed1");
    const w = page("upcoming", {}, [wed]);
    const tomorrow = screen.getByText("Take Out the Bins").closest(".rem-card")!.querySelector(".facts .fact")!;
    expect(tomorrow).toHaveTextContent("Tomorrow");
    expect(tomorrow).toHaveClass("warn");
    expect(tomorrow).not.toHaveClass("date");
    w.unmount();
    page("routines");
    const paused = screen.getByText("Stretch").closest(".rem-card")!.querySelector(".facts")!;
    expect([...paused.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Paused"]);
  });

  // AMENDED 2026-10-05 (rule 12): no grey card holding only an action. The empty
  // state keeps its own words and the screen's one filled primary.
  it("with nothing in the view, the empty state carries its Add, with no box round it", () => {
    const onNew = vi.fn();
    render(<RemindersPage chrome={{ back: "Today", onBack: noop }} sections={[]} tab="upcoming" onTab={noop}
      query="" onQuery={noop} searchOpen={false} onSearchToggle={noop} today={TUE} onNew={onNew} onSettings={noop} onOpen={noop}
      onTick={noop} onSnooze={noop} onResume={noop} onRestore={noop} />);
    expect(screen.getByText("Nothing Coming Up")).toBeInTheDocument();
    expect(document.querySelector(".rem-page .list-card-ruled")).toBeNull();
    fireEvent.click(screen.getByText("Add a Reminder", { selector: ".empty-state .btn-primary" }));
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

// 2026-10-04: a Reminders search is one list over every reminder, whatever
// view is open, done ones included. The scope line named the open view
// ("Today Reminders") and offered "Search Done Too", a button that only
// switched the view and changed no row. It names what was searched, and the
// one cut that does narrow it, the Area, is the one it offers to undo.
describe("RemindersPage: what a search says it searched", () => {
  const rows = [
    item({ time: "09:00" }, "Call Plumber", "w1", "c-work"),
    item({ time: "10:00" }, "Call Mother", "f1", "c-fam"),
    item({ time: "07:00", lastDone: TUE }, "Call Dentist", "w2", "c-work"),
  ];
  const searching = (tab: PageTab) => page(tab, { query: "call", sections: pageSections(rows, tab, TUE, "09:30", "call") }, rows);
  const scope = () => document.querySelector(".hdr-scope-n")?.textContent;

  it("names every reminder, not the open view, and has no Done button to offer", () => {
    for (const tab of ["today", "upcoming", "routines", "done"] as PageTab[]) {
      const r = searching(tab);
      expect(scope(), tab).toBe("3 Results in All Reminders");
      expect(screen.queryByText("Search Done Too"), tab).toBeNull();
      expect(document.querySelector(".hdr-scope-all"), tab).toBeNull();
      r.unmount();
    }
  });

  it("an Area cut is named in the line and is the one thing Search All Areas undoes", () => {
    setCategoryRegistry([{ id: "c-work", name: "Work", color: "blue" }, { id: "c-fam", name: "Family", color: "pink" }]);
    searching("today");
    fireEvent.click(document.querySelector('.hdr-controls .dd[aria-label="Area"]')!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Work" }));
    expect(scope()).toBe("2 Results in All Reminders in Work");
    fireEvent.click(screen.getByText("Search All Areas"));
    expect(scope()).toBe("3 Results in All Reminders");
    expect(screen.queryByText("Search All Areas")).toBeNull();
  });
});
