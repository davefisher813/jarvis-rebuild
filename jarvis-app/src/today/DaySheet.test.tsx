// @vitest-environment jsdom
// The day ring's sheet on its own (pass-off item 22, Dave 2026-10-06: "Still Open on top, Done below"). TodayFlow's
// end-to-end ring tests live in DayRing.sheet.test.tsx; this file pins the sheet's order, the sections it leaves out
// when they would be empty, the row as the door to its task, and every way out.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { TaskItem } from "../tasks/TasksService";
import { useSheetEscape } from "../shared/useSheetEscape";
import DaySheet from "./DaySheet";

const TODAY = "2026-10-10";
const task = (id: string, text: string, extra: Partial<TaskItem["data"]> = {}): TaskItem =>
  ({ id, data: { text, category: "work", done: false, due: TODAY, ...extra } }) as TaskItem;

function open(tasks: TaskItem[]) {
  const cb = { onToggle: vi.fn(), onTomorrow: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
  render(<DaySheet tasks={tasks} today={TODAY} {...cb} />);
  const sheet = screen.getByRole("dialog", { name: "Today’s Tasks" });
  const heads = () => [...sheet.querySelectorAll(".sh2 .t")].map((n) => n.textContent);
  const titles = () => [...sheet.querySelectorAll(".row .conn-name")].map((n) => n.textContent);
  return { sheet, heads, titles, ...cb };
}

afterEach(cleanup);

describe("the day sheet's order", () => {
  it("lists what is still open first and what is done after, whatever order the list arrives in", () => {
    const { heads, titles } = open([
      task("a", "Send the Invoice", { done: true, lastDone: TODAY }),
      task("b", "Call the Bank"),
      task("c", "Book the Flight", { done: true, lastDone: TODAY }),
      task("d", "Pay the Ticket"),
    ]);
    expect(heads()).toEqual(["Still Open", "Done"]);
    expect(titles()).toEqual(["Call the Bank", "Pay the Ticket", "Send the Invoice", "Book the Flight"]);
  });

  it("counts each section in its own head", () => {
    const { sheet } = open([task("a", "One"), task("b", "Two"), task("c", "Three", { done: true, lastDone: TODAY })]);
    expect([...sheet.querySelectorAll(".sh2 .n")].map((n) => n.textContent)).toEqual(["2", "1"]);
  });

  it("draws only what the ring counts: no reminders, nothing due another day", () => {
    const { titles } = open([
      task("a", "Due Today"),
      task("b", "Due Tomorrow", { due: "2026-10-11" }),
      task("c", "Take Vitamins", { reminder: { at: "09:00" } as never }),
    ]);
    expect(titles()).toEqual(["Due Today"]);
  });
});

describe("an empty section is not drawn", () => {
  it("nothing done yet: Still Open alone, with no Done head and no empty state", () => {
    const { sheet, heads } = open([task("a", "Call the Bank"), task("b", "Pay the Ticket")]);
    expect(heads()).toEqual(["Still Open"]);
    expect(sheet.querySelector(".empty-state")).toBeNull();
    expect(sheet.querySelectorAll(".list-card-ruled")).toHaveLength(1);
  });

  it("everything done: Done alone, with no Still Open head and no empty state", () => {
    const { sheet, heads, titles } = open([
      task("a", "Call the Bank", { done: true, lastDone: TODAY }),
      task("b", "Pay the Ticket", { done: true, lastDone: TODAY }),
    ]);
    expect(heads()).toEqual(["Done"]);
    expect(titles()).toEqual(["Call the Bank", "Pay the Ticket"]);
    expect(sheet.querySelector(".empty-state")).toBeNull();
    expect(sheet.querySelectorAll(".list-card-ruled")).toHaveLength(1);
  });

  it("nothing at all: the sheet closes itself instead of standing open over nothing", () => {
    const { sheet, heads, onClose } = open([]);
    expect(heads()).toEqual([]);
    expect(sheet.querySelector(".list-card-ruled")).toBeNull();
    expect(sheet.querySelector(".empty-state")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moving the last task to Tomorrow empties the sheet, and the sheet closes", () => {
    const cb = { onToggle: vi.fn(), onTomorrow: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<DaySheet tasks={[task("a", "Call the Bank")]} today={TODAY} {...cb} />);
    expect(cb.onClose).not.toHaveBeenCalled();
    rerender(<DaySheet tasks={[task("a", "Call the Bank", { due: "2026-10-11" })]} today={TODAY} {...cb} />);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it("a sheet with something in it never closes itself", () => {
    const { onClose } = open([task("a", "Call the Bank", { done: true, lastDone: TODAY })]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the rows", () => {
  it("each row, open or done, is the door to its own task", () => {
    const { sheet, onOpen } = open([task("a", "Call the Bank"), task("b", "Book the Flight", { done: true, lastDone: TODAY })]);
    const rows = [...sheet.querySelectorAll<HTMLElement>(".row")];
    expect(rows.map((r) => r.getAttribute("role"))).toEqual(["button", "button"]);
    fireEvent.click(rows[1]!);
    expect(onOpen).toHaveBeenLastCalledWith("b");
    fireEvent.click(rows[0]!);
    expect(onOpen).toHaveBeenLastCalledWith("a");
  });

  it("the check and Tomorrow act on the row without opening it", () => {
    const { sheet, onOpen, onToggle, onTomorrow } = open([task("a", "Call the Bank")]);
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Mark done" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Tomorrow" }));
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(onTomorrow).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("names each row's area with its dot", () => {
    const { sheet } = open([task("a", "Call the Bank")]);
    const meta = sheet.querySelector(".row .conn-meta")!;
    expect(meta.querySelector(".cat-dot")).not.toBeNull();
    expect(meta.textContent).toBe("Work");
  });
});

describe("the way out", () => {
  it("is the sheet's own card, a bottom sheet with the handle and a foot", () => {
    const { sheet } = open([task("a", "Call the Bank")]);
    expect(sheet.parentElement!.classList.contains("sheet-scrim")).toBe(true);
    expect(sheet.classList.contains("xs")).toBe(true);
    expect(sheet.querySelector(".sheet-handle")).not.toBeNull();
    expect(sheet.querySelector(".xs-foot")).not.toBeNull();
  });

  it("Done in the bar closes it", () => {
    const { sheet, onClose } = open([task("a", "Call the Bank")]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a tap above the sheet closes it, a tap inside does not", () => {
    const { sheet, onClose } = open([task("a", "Call the Bank")]);
    fireEvent.click(sheet);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(sheet.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes it", () => {
    function Esc() { useSheetEscape(); return null; }
    render(<Esc />);
    const { onClose } = open([task("a", "Call the Bank")]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
