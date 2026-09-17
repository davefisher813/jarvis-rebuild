// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { editedLabel, type NoteListItem } from "./NotesList";
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
    expect(editedLabel(at(0, 0), NOW)).toBe("Edited today");
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

  it("the second line is the area's dot and name, then when; unfiled wears yellow and says so", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const { container } = render(<NotesList notes={notes} />);
      const rows = container.querySelectorAll(".note-row");
      expect(rows[0]!.querySelector(".r-parent .r-pg")).toHaveClass("cat-fg-blue");
      expect(rows[0]!.querySelector(".r-parent .r-goal-t")).toHaveTextContent("Work");
      expect(rows[0]!.querySelector(".r-when")).toHaveTextContent("Edited today");
      expect(rows[1]!.querySelector(".r-parent .r-pg")).toHaveClass("cat-fg-yellow");
      expect(rows[1]!.querySelector(".r-parent .r-goal-t")).toHaveTextContent("Not Filed");
      expect(rows[3]!.querySelector(".r-when")).toBeNull();
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
    fireEvent.click(document.querySelector('.hdr-drops .dd[aria-label="Area"]')!);
    await Promise.resolve();
  };
  const pickArea = (name: string) => fireEvent.click(screen.getByRole("menuitemradio", { name }));

  it("is a dropdown under the chips, not a chip", () => {
    const { container } = render(<NotesList notes={notes} />);
    expect(container.querySelector('.hdr-chips [aria-label="Area"]'), "it is not a view").toBeNull();
    expect([...container.querySelectorAll(".hdr-chips .chip")].map((c) => c.textContent)).toEqual(["All", "Pinned", "Unfiled"]);
    // Area leads; Tag joins it only on a library that actually has tags, so
    // an empty capsule is never drawn (these notes have none).
    const drops = [...container.querySelectorAll(".hdr-drops .dd")];
    expect(drops.map((d) => d.getAttribute("aria-label"))).toEqual(["Area"]);
    expect(drops[0]).toHaveTextContent("All Areas");
  });

  it("narrows the list, and the capsule states which area", async () => {
    const { container } = render(<NotesList notes={notes} />);
    await openArea();
    pickArea("Family");
    expect([...container.querySelectorAll(".note-row .task-name")].map((e) => e.textContent))
      .toEqual(["Bridge Invitational Item List"]);
    // handoff rule 7: never leave someone wondering why records disappeared.
    // The control says its own answer, so no second line has to.
    expect(container.querySelector('.hdr-drops .dd[aria-label="Area"]')).toHaveTextContent("Family");
  });

  // The whole point: two cuts that compose. The selected view stays selected.
  it("keeps the chosen view selected while an area narrows it", async () => {
    const { container } = render(<NotesList notes={notes} />);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    await openArea();
    pickArea("Work");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect([...container.querySelectorAll(".note-row .task-name")].map((e) => e.textContent))
      .toEqual(["Coach Onboarding Plan"]);
  });

  // Unfiled means "has no area", so an area and that view can never both be
  // true: choosing one moves off the other rather than leaving a list that is
  // empty by construction.
  it("moves off Unfiled rather than showing a list that cannot have anything in it", async () => {
    const { container } = render(<NotesList notes={notes} />);
    fireEvent.click(screen.getByRole("tab", { name: "Unfiled" }));
    await openArea();
    pickArea("Work");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
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
    expect(container.querySelector('.hdr-drops .dd[aria-label="Area"]')).toHaveTextContent("All Areas");
  });
});
