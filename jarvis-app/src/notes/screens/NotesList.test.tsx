// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { editedLabel, leadingDate, rowLine, type NoteListItem } from "./NotesList";
import { setCategoryRegistry } from "../../shared/categories";

// NOTES, PORTED (Notes and Money catalog, 2026-09-02). The library is the
// task list's card, its rows carry the area and the edit date, and its heads
// are the day. These pin the words and the order.

const NOW = new Date(2026, 8, 2, 14, 0, 0); // Wed Sep 2, 2026, 2pm
const at = (daysAgo: number, hour = 9) => new Date(2026, 8, 2 - daysAgo, hour).getTime();

setCategoryRegistry([
  { id: "c-work", name: "Work", color: "blue" },
  { id: "c-fam", name: "Family", color: "pink" },
]);

const notes: NoteListItem[] = [
  { id: "old", title: "Bridge Invitational Item List", edited: at(5), category: "c-fam", first: "Tents and tables", body: "Tents and tables" },
  { id: "new", title: "Coach Onboarding Plan", edited: at(0, 12), category: "c-work", first: "", body: "" },
  { id: "y", title: "Training Plan", edited: at(1, 23), category: "", first: "Base week.", body: "Base week." },
  { id: "undated", title: "Scratch", edited: 0, category: "", first: "", body: "" },
];

describe("editedLabel", () => {
  it("reads the calendar, not the clock", () => {
    expect(editedLabel(at(0, 0), NOW)).toBe("Edited Today");
    expect(editedLabel(at(1, 23), NOW)).toBe("Yesterday");
    expect(editedLabel(at(5), NOW)).toBe("Aug 28");
    expect(editedLabel(new Date(2025, 11, 31).getTime(), NOW)).toBe("Dec 31, 2025");
    expect(editedLabel(0, NOW)).toBe("");
  });
});

describe("NotesList", () => {
  it("groups by the day it was touched, newest first, the undated behind everything", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const { container } = render(<NotesList notes={notes} />);
      const heads = [...container.querySelectorAll(".sh2 .t")].map((el) => el.textContent);
      expect(heads).toEqual(["Today", "Yesterday", "Earlier"]);
      const names = [...container.querySelectorAll(".note-row .task-name")].map((el) => el.textContent);
      expect(names).toEqual(["Coach Onboarding Plan", "Training Plan", "Bridge Invitational Item List", "Scratch"]);
      expect(container.querySelector(".lib-row")).toBeNull();
      expect(container.querySelectorAll(".card.list-card-ruled")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // §AK (R1), 2026-09-26: "Not Filed" under every unfiled note was a
  // placeholder, a line saying there was nothing to say. An unfiled row
  // names no area, and a row with nothing at all under its title draws no
  // empty second line.
  // AMENDED 2026-09-26 (pass-off): the day is said once, above the group
  // (catalog §B). Under Today and Yesterday the row repeats no date; under
  // Earlier the date is the row's own.
  // AMENDED 2026-10-09 (Dave, the pass-off, item 14: the unified chip, "same format on notes: the note preview sits next to
  // the chip. Rows with no category show no chip at all"). The area is a small chip in its colour, which replaces the dot,
  // and the note's own first line sits right next to it; the same piece a task row draws its area and project with.
  // AMENDED 2026-10-11 (Dave, "match the mock exactly": unified-chip-system-mockup-2026-10-09). Line one is the title with
  // the date at its right; line two is the area's chip and the note's preview beside it. Unfiled: no chip. A note with
  // neither a chip nor a preview has no second line.
  it("line one is the title and the date; line two is the chip and the preview; unfiled shows no chip", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const { container } = render(<NotesList notes={notes} />);
      const rows = container.querySelectorAll(".note-row");
      // Today, filed, no body: title alone on line one (the Today head says the day), the chip alone on line two.
      expect([...rows[0]!.querySelector(".note-line1")!.children].map((c) => c.className)).toEqual(["task-name"]);
      expect([...rows[0]!.querySelector(".note-sub")!.children].map((c) => c.className)).toEqual(["cat-chip"]);
      expect(rows[0]!.querySelector(".note-sub .cat-chip")).toHaveTextContent("Work");
      expect(rows[0]!.querySelector(".note-sub .cat-chip-dot")).toHaveClass("cat-bg-blue");
      expect(rows[0]!.querySelector(".note-line1 .cat-chip"), "the chip is not on the title line").toBeNull();
      // Yesterday, unfiled: no chip, the preview alone.
      expect(rows[1]!.querySelector(".cat-chip")).toBeNull();
      expect([...rows[1]!.querySelector(".note-sub")!.children].map((c) => c.className)).toEqual(["r-goal note-preview"]);
      expect(rows[1]!.querySelector(".note-preview")).toHaveTextContent("Base week.");
      expect(rows[1]!.querySelector(".note-date"), "the Yesterday head already says it").toBeNull();
      expect(rows[1]!.textContent).not.toMatch(/Not Filed/);
      // Earlier, filed, with a body: the date on line one at the right of the title, then chip and preview.
      expect([...rows[2]!.querySelector(".note-line1")!.children].map((c) => c.className)).toEqual(["task-name", "note-date"]);
      expect(rows[2]!.querySelector(".note-line1 .note-date")).toHaveTextContent("Aug 28");
      expect([...rows[2]!.querySelector(".note-sub")!.children].map((c) => c.className)).toEqual(["cat-chip", "r-goal note-preview"]);
      expect(rows[2]!.querySelector(".note-preview")).toHaveTextContent("Tents and tables");
      expect(rows[2]!.querySelector(".note-sub .note-date"), "the date is not on line two").toBeNull();
      // No date, no area, no body: a title and nothing else.
      expect(rows[3]!.querySelector(".note-date")).toBeNull();
      expect(rows[3]!.querySelector(".note-sub")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Dave 2026-10-11: "Never render a label with nothing after it", one date per row, and the second line is ONE thing.
  it("a meeting note never shows a bare Attendees label or a second date", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const meeting: NoteListItem[] = [
        { id: "m", title: "Convo with Berto", edited: at(3), category: "c-work", first: "Aug 24 \u00b7 Attendees", lines: ["Aug 24 \u00b7 Attendees", "Talked about the Q4 timeline and next steps"], body: "" },
        { id: "e", title: "Meeting Notes", edited: at(4), category: "", first: "Sep 15 \u00b7 Attendees", lines: ["Sep 15 \u00b7 Attendees"], body: "" },
        { id: "w", title: "Board Sync", edited: at(5), category: "c-work", first: "Aug 20 \u00b7 Attendees: Wei, Sam Okafor", lines: ["Aug 20 \u00b7 Attendees: Wei, Sam Okafor", "Agenda notes"], body: "" },
      ];
      const { container } = render(<NotesList notes={meeting} />);
      const row = (t: string) => [...container.querySelectorAll(".note-row")].find((r) => r.textContent!.includes(t))!;
      const berto = row("Berto");
      expect(berto.querySelector(".note-preview")).toHaveTextContent("Talked about the Q4 timeline and next steps");
      expect(berto.textContent).not.toMatch(/Attendees|Aug 24|\u00b7/);
      expect(berto.querySelectorAll(".note-date")).toHaveLength(1);
      expect(berto.querySelector(".note-date")).toHaveTextContent("Aug 30");
      // Nothing but the empty label: unfiled, so no second line at all.
      expect(row("Meeting Notes").querySelector(".note-sub")).toBeNull();
      // Names typed after the label: who it was with, and only that.
      expect(row("Board Sync").querySelector(".note-preview")).toHaveTextContent(/^With: Wei, Sam Okafor$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rowLine: one thing, never a bare label", () => {
    expect(rowLine(["Aug 24 \u00b7 Attendees"])).toEqual({ date: "Aug 24", with: [], preview: "" });
    expect(rowLine(["Aug 24 \u00b7 Attendees", "Q4 timeline"])).toEqual({ date: "Aug 24", with: [], preview: "Q4 timeline" });
    expect(rowLine(["Attendees: Wei and Sam Okafor", "x"]).with).toEqual(["Wei", "Sam Okafor"]);
    expect(rowLine(["With Wei and Sam Okafor"]).with).toEqual(["Wei", "Sam Okafor"]);
    expect(rowLine(["With the new budget we can hire"]).preview, "a sentence is not a guest list").toBe("With the new budget we can hire");
    expect(rowLine(["Base week.", "With Wei"]).preview).toBe("Base week.");
    expect(rowLine([])).toEqual({ date: "", with: [], preview: "" });
  });

  it("leadingDate reads a month and day at the start only", () => {
    expect(leadingDate("Aug 24 \u00b7 Attendees")).toEqual({ date: "Aug 24", rest: "Attendees" });
    expect(leadingDate("September 5: kickoff")).toEqual({ date: "Sep 5", rest: "kickoff" });
    expect(leadingDate("Oct 3, 2026 | Notes")).toEqual({ date: "Oct 3", rest: "Notes" });
    expect(leadingDate("Mayor 3 votes")).toBeNull();
    expect(leadingDate("Aug 245 widgets")).toBeNull();
    expect(leadingDate("Met on Aug 24")).toBeNull();
    expect(leadingDate("")).toBeNull();
  });

  // The Pinned head is not a day, so a pinned note edited today still says
  // when it was touched.
  it("a pinned note keeps its date, because its head is Pinned, not a day", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const pinned: NoteListItem[] = [{ id: "p", title: "Packing List", edited: at(0, 12), category: "", first: "", body: "", pinned: true }];
      const { container } = render(<NotesList notes={pinned} />);
      expect(container.querySelector(".sh2 .t")).toHaveTextContent("Pinned");
      expect(container.querySelector(".note-row .note-line1 .note-date")).toHaveTextContent("Edited Today");
    } finally {
      vi.useRealTimers();
    }
  });

  // Dave 2026-09-26 (the pass-off): his typed titles are SHOWN in Title Case
  // everywhere and stored unchanged. Only the drawn name is cased; the row's
  // labels keep what he typed, so nothing that looks a note up changes.
  it("shows his typed title in Title Case and keeps the raw title for the labels", () => {
    const typed: NoteListItem[] = [{ id: "j", title: "jarvis updates", edited: at(5), category: "c-work", first: "", body: "" }];
    const { container } = render(<NotesList notes={typed} onDelete={() => {}} />);
    expect(container.querySelector(".note-row .task-name")).toHaveTextContent("Jarvis Updates");
    expect(screen.getByLabelText("Delete jarvis updates")).toBeInTheDocument();
  });

  // AMENDED 2026-10-11 (Dave: "No search debris ('Found 5') in rows"; "the second line should be ONE thing"). The tags
  // and the count of what JARVIS found stay on the note; the row draws neither, and types no dots.
  it("the row draws no tags and no found count, and types no dots", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const tagged: NoteListItem[] = [
        { id: "t", title: "Offsite Ideas", edited: at(3), category: "c-work", first: "Venues first", body: "", tags: ["ideas", "q3"], found: 5 },
      ];
      const { container } = render(<NotesList notes={tagged} />);
      const r = container.querySelector(".note-row") as HTMLElement;
      expect(r.textContent).not.toMatch(/\u00b7/);
      expect(r.textContent).not.toMatch(/Found|#ideas|5/);
      expect([...r.querySelector(".note-sub")!.children].map((c) => c.className)).toEqual(["cat-chip", "r-goal note-preview"]);
      expect(r.querySelector(".note-date")?.textContent).toBe("Aug 30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a note on tap, and in selection the box takes the check column", () => {
    const onOpen = vi.fn();
    const onDeleteMany = vi.fn();
    // The select bar portals into the shell's host.
    const host = document.createElement("div"); host.id = "select-bar-host"; document.body.appendChild(host);
    const { container } = render(<NotesList notes={notes} onOpen={onOpen} onDeleteMany={onDeleteMany} />);
    fireEvent.click(screen.getByText("Coach Onboarding Plan"));
    expect(onOpen).toHaveBeenCalledWith("new");
    // AMENDED 2026-09-17 (Unified Headers): Select is a row in the options
    // sheet now, the one place all five pages keep their secondary tools.
    fireEvent.click(screen.getByLabelText("Notes Options"));
    fireEvent.click(screen.getByText("Select Notes"));
    expect(container.querySelectorAll(".note-row .task-check-tap .sel-box")).toHaveLength(4);
    fireEvent.click(screen.getByLabelText("Select Training Plan"));
    fireEvent.click(document.querySelector(".select-del")!);
    expect(onDeleteMany).toHaveBeenCalledWith(["y"]);
  });

  it("searches the titles and says so when nothing matches", () => {
    const { container } = render(<NotesList notes={notes} />);
    // AMENDED 2026-09-17: the field is the shared header's, and it names what
    // it searches rather than saying "Search".
    fireEvent.change(screen.getByPlaceholderText("Search Notes"), { target: { value: "zzz" } });
    expect(container.querySelectorAll(".note-row")).toHaveLength(0);
    expect(screen.getByText(/No notes match/)).toBeInTheDocument();
  });

  // S6-Q37 (2026-09-04): "in-page search ignores note bodies." A query that
  // matches only a note's body -- never its title -- must still surface it.
  it("searches the body too, not just the title", () => {
    const { container } = render(<NotesList notes={notes} />);
    fireEvent.change(screen.getByPlaceholderText("Search Notes"), { target: { value: "tents" } });
    const names = [...container.querySelectorAll(".note-row .task-name")].map((el) => el.textContent);
    expect(names).toEqual(["Bridge Invitational Item List"]);
  });
});

// DAVE, 2026-09-17: "Don't forget to add it to notes page as well" -- the
// pinned Area menu Tasks got the same afternoon.
//
// It is more than a move. The area used to be a MEMBER of this page's filter
// union, which made it a view: picking Family deselected All, Pinned and
// Unfiled, because a note could only be in one of them at a time. That is not
// what an area is, and it is not how Tasks has ever worked.
// AMENDED 2026-09-17 (Dave: "Look at what happens to the chips when they
// slide. This is simply not going to work"). The area menu spent one deploy
// pinned beside the chips; at phone width that row then had to scroll, and a
// scrolling row of large filled pills is cut in half at every resting
// position. Nothing sits beside the chips now -- the area is a row in the
// options sheet, and the line under the chips says when it is narrowing the
// list. What this file is really about is unchanged and is the important
// part: the area is its own AXIS, not a view, so the two compose.
describe("the Notes area is its own cut, composing with the view", () => {
  // The sheet is a portal; the page behind it also prints area names on its
  // rows, so every lookup inside it is scoped to the sheet.
  const sheet = () => within(document.querySelector(".sheet-scrim") as HTMLElement);
  // AMENDED 2026-09-17 (Dave: "Make multiple dropdown chips like areas in the
  // most logical way possible. Stack dropdowns next to each other"). Area was
  // a row in the options sheet for one deploy; it is a dropdown on the
  // header's own line now, beside Tag, which is where the two lists that grow
  // with the library belong. It still is not a VIEW.
  const openArea = async () => {
    fireEvent.click(document.querySelector('.hdr-controls .dd[aria-label="Area"]')!);
    await Promise.resolve();
  };
  const pickArea = (name: string) => fireEvent.click(screen.getByRole("menuitemradio", { name }));

  it("shares the view's line, and is not a view", () => {
    const { container } = render(<NotesList notes={notes} />);
    // One line across (2026-09-18): the view, then the cuts. Tag joins it
    // only on a library that actually has tags, so an empty capsule is never
    // drawn (these notes have none).
    const line = [...container.querySelectorAll(".hdr-controls .dd")];
    expect(line.map((d) => d.getAttribute("aria-label"))).toEqual(["View", "Area"]);
    expect(line[0]).toHaveTextContent("All");
    expect(line[1]).toHaveTextContent("Area");
    // The area is still not a MEMBER of the view list: the two cuts compose.
    fireEvent.click(screen.getByLabelText("View"));
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["All", "Pinned", "Unfiled"]);
  });

  it("narrows the list, and the capsule states which area", async () => {
    const { container } = render(<NotesList notes={notes} />);
    await openArea();
    pickArea("Family");
    expect([...container.querySelectorAll(".note-row .task-name")].map((e) => e.textContent))
      .toEqual(["Bridge Invitational Item List"]);
    // handoff rule 7: never leave someone wondering why records disappeared.
    // The control says its own answer, so no second line has to.
    expect(container.querySelector('.hdr-controls .dd[aria-label="Area"]')).toHaveTextContent("Family");
  });

  // The whole point: two cuts that compose. The selected view stays selected.
  it("keeps the chosen view selected while an area narrows it", async () => {
    const { container } = render(<NotesList notes={notes} />);
    await openArea();
    pickArea("Work");
    expect(screen.getByLabelText("View"), "the view it was on stays on").toHaveTextContent("All");
    expect([...container.querySelectorAll(".note-row .task-name")].map((e) => e.textContent))
      .toEqual(["Coach Onboarding Plan"]);
  });

  // Unfiled means "has no area", so an area and that view can never both be
  // true: choosing one moves off the other rather than leaving a list that is
  // empty by construction.
  it("moves off Unfiled rather than showing a list that cannot have anything in it", async () => {
    const { container } = render(<NotesList notes={notes} />);
    fireEvent.click(screen.getByLabelText("View"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Unfiled" }));
    await openArea();
    pickArea("Work");
    expect(screen.getByLabelText("View")).toHaveTextContent("All");
    expect(container.querySelectorAll(".note-row")).toHaveLength(1);
  });

  it("clears from the same capsule that set it", async () => {
    const { container } = render(<NotesList notes={notes} />);
    await openArea();
    pickArea("Work");
    expect(container.querySelectorAll(".note-row")).toHaveLength(1);
    await openArea();
    pickArea("All Areas");
    expect(container.querySelectorAll(".note-row")).toHaveLength(4);
    expect(container.querySelector('.hdr-controls .dd[aria-label="Area"]')).toHaveTextContent("Area");
  });
});
