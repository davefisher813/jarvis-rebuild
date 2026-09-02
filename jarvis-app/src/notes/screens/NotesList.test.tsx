// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  { id: "old", title: "Bridge Invitational Item List", edited: at(5), category: "c-fam", first: "Tents and tables" },
  { id: "new", title: "Coach Onboarding Plan", edited: at(0, 12), category: "c-work", first: "" },
  { id: "y", title: "Training Plan", edited: at(1, 23), category: "", first: "Base week." },
  { id: "undated", title: "Scratch", edited: 0, category: "", first: "" },
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
    fireEvent.click(screen.getByText("Select"));
    expect(container.querySelectorAll(".note-row .task-check-tap .sel-box")).toHaveLength(4);
    fireEvent.click(screen.getByLabelText("Select Training Plan"));
    fireEvent.click(document.querySelector(".select-del")!);
    expect(onDeleteMany).toHaveBeenCalledWith(["y"]);
  });

  it("searches the titles and says so when nothing matches", () => {
    const { container } = render(<NotesList notes={notes} />);
    fireEvent.change(container.querySelector(".search-bar input")!, { target: { value: "zzz" } });
    expect(container.querySelectorAll(".note-row")).toHaveLength(0);
    expect(screen.getByText(/No notes match/)).toBeInTheDocument();
  });
});
