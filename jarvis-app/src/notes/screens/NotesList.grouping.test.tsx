// @vitest-environment jsdom
// THE GROUPING SWITCH AND THE NOTE CARD MATCHING THE APP (Dave 2026-10-31, the phone check of Punch 12).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import NotesList, { groupNotes, type NoteListItem } from "./NotesList";
import { setCategoryRegistry } from "../../shared/categories";

const NOW = new Date(2026, 9, 31, 12);
const at = (y: number, m: number, d: number) => new Date(y, m, d, 9).getTime();
const note = (id: string, edited: number, extra: Partial<NoteListItem> = {}): NoteListItem =>
  ({ id, title: id, edited, category: "", first: "", body: "", ...extra });

afterEach(() => { cleanup(); localStorage.clear(); });

describe("groupNotes", () => {
  const areas = ["work", "family"];
  beforeEach(() => setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }, { id: "family", name: "Family", color: "pink" }]));
  afterEach(() => setCategoryRegistry([]));
  it("by date: Today, Yesterday, Earlier This Week, then months (the year only when it is not this one), undated last", () => {
    const g = groupNotes([
      note("a", at(2026, 9, 31)), note("b", at(2026, 9, 30)), note("c", at(2026, 9, 27)),
      note("d", at(2026, 8, 3)), note("e", at(2025, 7, 1)), note("f", 0), note("g", at(2026, 9, 12)),
    ], "date", NOW);
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", "Earlier This Week", "October", "September", "August 2025", "No Date"]);
  });
  it("by subject: each note once, under its first tag, A to Z, untagged last as No Subject", () => {
    const g = groupNotes([
      note("a", 3, { tags: ["recruiting", "budget"] }), note("b", 2, { tags: ["Budget"] }), note("c", 1),
    ], "subject", NOW);
    expect(g.map((x) => [x.label, x.items.map((n) => n.id)])).toEqual([["Budget", ["b"]], ["Recruiting", ["a"]], ["No Subject", ["c"]]]);
  });
  it("by area: Settings order, then No Area; a pinned note leads its section", () => {
    const g = groupNotes([
      note("a", 3, { category: areas[1]! }), note("b", 2, { category: areas[0]! }), note("c", 1, { category: areas[0]!, pinned: true }),
      note("d", 0),
    ], "area", NOW);
    expect(g.map((x) => [x.area, x.items.map((n) => n.id)])).toEqual([[areas[0], ["c", "b"]], [areas[1], ["a"]], [null, ["d"]]]);
  });
});

describe("the switch on the page", () => {
  it("defaults to By Area, switches to By Date with plain heads (no chip), and is kept on the device", () => {
    const notes = [note("Plan", Date.now(), { tags: ["season"] })];
    render(<NotesList notes={notes} onOpen={() => {}} />);
    const sw = screen.getByRole("button", { name: /Group Notes/ });
    expect(sw).toHaveTextContent("By Area");
    fireEvent.click(sw);
    fireEvent.click(screen.getAllByText("By Date").at(-1)!);
    const head = document.querySelector(".note-group-head")!;
    expect(head).toHaveTextContent("Today");
    expect(within(head as HTMLElement).queryByText(/No Area/)).toBeNull();
    expect(document.querySelector(".note-area-head .cat-chip, .note-group-head .cat-chip")).toBeNull();
    expect(localStorage.getItem("jarvis.notes.groupBy.v1")).toBe("date");
    cleanup();
    render(<NotesList notes={notes} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /Group Notes/ })).toHaveTextContent("By Date");
  });
});

describe("the note card matches the app", () => {
  const css = readFileSync(resolve(__dirname, "../../styles/ruled.css"), "utf8");
  it("the red margin line is gone", () => {
    expect(css).not.toMatch(/note-card::before/);
    expect(css).not.toMatch(/notes-trial/);
  });
  it("the title wears the task row's size, weight and tracking; the preview is untouched (still italic)", () => {
    const rule = [...css.matchAll(/\.ruled \.note-row \.note-line1 > \.task-name \{([^}]*)\}/g)].map((m) => m[1]!).find((r) => /font-size/.test(r))!;
    expect(rule).toMatch(/font-size: var\(--t-name\)/);
    expect(rule).toMatch(/font-weight: var\(--w-name\)/);
    expect(rule).toMatch(/letter-spacing: var\(--track-name\)/);
    expect(rule).not.toMatch(/18px/);
    expect(css).toMatch(/\.ruled\.notes-list \.note-row \.note-preview \{ font-style: italic; \}/);
  });
  it("a note row is the Life task row's height", () => {
    expect(css).toMatch(/\.ruled\.notes-list \.note-card \.note-row \{ min-height: 64px; \}/);
  });
});
