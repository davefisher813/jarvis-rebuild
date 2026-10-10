// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AnytimeRow from "./AnytimeRow";
import type { TaskItem } from "../../tasks/TasksService";

// ONE DOOR, WORN AS A PILL (Dave 2026-08-31, Schedule screenshot: "'9 open'
// should be in a white/black button like the home page"). The head count IS
// the expand toggle, in the same .see-all.pill-action capsule every home
// head action wears; the old "N more" footer door is gone. Under the cap the
// count stays a quiet label -- a button that does nothing is not a button.
const task = (i: number): TaskItem =>
  ({ id: "t" + i, data: { text: "Task " + i } }) as unknown as TaskItem;

const many = Array.from({ length: 9 }, (_, i) => task(i));

describe("AnytimeRow: the count is the one expand door", () => {
  it("overflow: the count renders as the home-style pill and toggles the list", () => {
    const { getByRole, queryByRole, container } = render(<AnytimeRow items={many} />);
    const pill = getByRole("button", { name: /show all 9 anytime tasks/i });
    expect(pill).toHaveClass("see-all", "pill-action");
    expect(pill).toHaveTextContent("9 Open");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll(".anytime-row").length).toBe(5);

    fireEvent.click(pill);
    expect(container.querySelectorAll(".anytime-row").length).toBe(9);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(pill).toHaveTextContent("Show Less");

    fireEvent.click(pill);
    expect(container.querySelectorAll(".anytime-row").length).toBe(5);

    // The duplicate footer door stays dead in both states.
    expect(container.querySelector(".anytime-more")).toBeNull();
    expect(queryByRole("button", { name: /more/i })).toBeNull();
  });

  it("under the cap: a quiet label, never a dead button", () => {
    const { container, queryByRole } = render(<AnytimeRow items={[task(1), task(2)]} />);
    // The ruled head (2026-09-02): the count sits in the head's own count
    // slot, a label, never a button.
    const label = container.querySelector(".anytime-head .n");
    expect(label).toHaveTextContent("2");
    expect(label?.tagName).not.toBe("BUTTON");
    expect(container.querySelector(".anytime-head .pill-action")).toBeNull();
    expect(queryByRole("button", { name: /show all/i })).toBeNull();
  });
});

// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15, photographed this row: "I want
// all rows clickable"). The row opens the task; the ring keeps its own verb
// and never also opens it.
describe("AnytimeRow: the row opens the task", () => {
  it("row tap and Enter open; the ring completes", () => {
    const onOpen = vi.fn(), onToggle = vi.fn();
    const { getByRole } = render(<AnytimeRow items={[task(1)]} onOpen={onOpen} onToggle={onToggle} />);
    const row = getByRole("button", { name: "Open Task 1" });
    fireEvent.click(row.querySelector(".task-name")!);
    expect(onOpen).toHaveBeenCalledWith("t1");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.click(getByRole("checkbox", { name: "Complete Task 1" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

// CLEAN ROWS, NO PILLS (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC.md). The Drop pill that sat in every Anytime row is the
// swipe left, the first line of the long-press menu and, once the task is overdue, one quiet word on the row.
const touch = (el: Element, type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
  fireEvent[type](el, { touches: type === "touchEnd" ? [] : [{ clientX: x, clientY: 0 }] });
const row = (c: HTMLElement) => c.querySelector(".anytime-row")!;

describe("AnytimeRow: clean rows, the action is the gesture", () => {
  it("draws no capsule in any row, and no Drop button on the row itself", () => {
    const { container } = render(<AnytimeRow items={many} onSchedule={() => {}} onToggle={() => {}} onOpen={() => {}} />);
    expect(container.querySelectorAll(".anytime-row .pill-act, .anytime-row .row-act, .anytime-row .btn-sm, .anytime-card .pill-act").length).toBe(0);
    expect(container.querySelectorAll(".anytime-row .row-ctx").length, "a future task stays clean").toBe(0);
  });

  it("swipe left reveals Drop, the row's one quickest action, and it gives the task a time", () => {
    const onSchedule = vi.fn();
    const { container } = render(<AnytimeRow items={[task(1)]} onSchedule={onSchedule} onToggle={() => {}} />);
    const r = row(container);
    touch(r, "touchStart", 200); touch(r, "touchMove", 100); touch(r, "touchEnd", 100);
    expect((r as HTMLElement).style.transform).toBe("translateX(-88px)"); // one button wide: no Delete wired here
    const drop = container.querySelector(".task-verb")!;
    expect(drop.textContent).toBe("Drop");
    expect(drop.getAttribute("aria-label")).toBe("Give Task 1 a time");
    fireEvent.click(drop);
    expect(onSchedule).toHaveBeenCalledWith("t1");
  });

  it("swipe right completes, and the row snaps back", () => {
    const onToggle = vi.fn();
    const { container } = render(<AnytimeRow items={[task(1)]} onSchedule={() => {}} onToggle={onToggle} />);
    const r = row(container);
    touch(r, "touchStart", 100); touch(r, "touchMove", 190); touch(r, "touchEnd", 190);
    expect(onToggle).toHaveBeenCalledWith("t1");
    expect((r as HTMLElement).style.transform).toBe("");
  });

  it("Delete is the second button of the rail, behind the reveal where it is on every task list", () => {
    const onDelete = vi.fn();
    const { container } = render(<AnytimeRow items={[task(1)]} onSchedule={() => {}} onDelete={onDelete} />);
    expect(Array.from(container.querySelectorAll(".task-swipe > button")).map((b) => b.textContent)).toEqual(["Drop", "Delete"]);
    fireEvent.click(container.querySelector(".task-del")!);
    expect(onDelete).toHaveBeenCalledWith("t1");
  });

  it("the long-press menu holds every action again: Drop, Done, Open Task, Delete", () => {
    const onSchedule = vi.fn(), onToggle = vi.fn(), onOpen = vi.fn(), onDelete = vi.fn();
    const { container } = render(<AnytimeRow items={[task(1)]} onSchedule={onSchedule} onToggle={onToggle} onOpen={onOpen} onDelete={onDelete} />);
    fireEvent.contextMenu(row(container));
    expect(Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent)).toEqual(["Drop", "Done", "Open Task", "Delete", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(onSchedule).toHaveBeenCalledWith("t1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("an overdue task, and only an overdue task, surfaces Drop as one quiet word on the row", () => {
    const onSchedule = vi.fn();
    const late = { id: "t9", data: { text: "File taxes", due: "2026-10-01" } } as unknown as TaskItem;
    const soon = { id: "t8", data: { text: "Plan trip", due: "2026-10-09" } } as unknown as TaskItem;
    const { container } = render(<AnytimeRow items={[late, soon]} today="2026-10-05" onSchedule={onSchedule} />);
    const words = container.querySelectorAll(".anytime-row .row-ctx");
    expect(words.length).toBe(1);
    expect(words[0]!.textContent).toBe("Drop");
    expect(words[0]!.closest(".anytime-row")!.textContent).toContain("File Taxes");
    // Text only: a capsule is a pill, and a pill is not allowed on a row.
    expect(words[0]!.className).not.toMatch(/pill|row-act|btn/);
    fireEvent.click(words[0]!);
    expect(onSchedule).toHaveBeenCalledWith("t9");
  });

  it("the title is Title Case, stored as typed", () => {
    const { container } = render(<AnytimeRow items={[{ id: "a", data: { text: "get new car insurance" } } as unknown as TaskItem, { id: "b", data: { text: "clear up allstate w ai" } } as unknown as TaskItem]} />);
    expect(Array.from(container.querySelectorAll(".task-name")).map((n) => n.textContent)).toEqual(["Get New Car Insurance", "Clear Up Allstate w AI"]);
  });
});

// THE UNIFIED CHIP (Dave 2026-10-09, the pass-off, item 14): an Anytime row draws its area the way every task row does, a
// small chip in the area's colour with the project right next to it, and no chip when there is no area.
describe("AnytimeRow: the area is the unified chip", () => {
  it("chips the area with the project beside it, and draws no chip for a row with no area", async () => {
    const { setCategoryRegistry } = await import("../../shared/categories");
    setCategoryRegistry([{ id: "fam", name: "Family", color: "pink" }]);
    const filed = { id: "a", data: { text: "Book the Hall", category: "fam", projectId: "p1" } } as unknown as TaskItem;
    const loose = { id: "b", data: { text: "Call the Bank" } } as unknown as TaskItem;
    const { container } = render(
      <AnytimeRow items={[filed, loose]} parentOf={(t) => (t.id === "a" ? { kind: "project", name: "Reunion", tone: "cat-fg-pink", pct: 20, cat: "fam" } : null)} />,
    );
    const rows = container.querySelectorAll(".anytime-row");
    const line = rows[0]!.querySelector(".r-k > .r-parent")!;
    expect(line.querySelector(".cat-chip.cat-fg-pink")).toHaveTextContent("Family");
    expect(line.querySelector(".r-goal-t")).toHaveTextContent("Reunion");
    expect(rows[0]!.querySelector(".r-pg, .r-pdot"), "the dot and the glyph are gone").toBeNull();
    expect(rows[1]!.querySelector(".cat-chip")).toBeNull();
  });
});
