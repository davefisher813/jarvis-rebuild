// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
// all rows clickable"). The row opens the task; Drop and the ring keep their
// own verbs and never also open it.
describe("AnytimeRow: the row opens the task", () => {
  it("row tap and Enter open; Drop schedules; the ring completes", () => {
    const onOpen = vi.fn(), onSchedule = vi.fn(), onToggle = vi.fn();
    const { getByRole } = render(<AnytimeRow items={[task(1)]} onOpen={onOpen} onSchedule={onSchedule} onToggle={onToggle} />);
    const row = getByRole("button", { name: "Open Task 1" });
    fireEvent.click(row.querySelector(".task-name")!);
    expect(onOpen).toHaveBeenCalledWith("t1");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.click(getByRole("button", { name: "Give Task 1 a time" }));
    expect(onSchedule).toHaveBeenCalledWith("t1");
    fireEvent.click(getByRole("checkbox", { name: "Complete Task 1" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
