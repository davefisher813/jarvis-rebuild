// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReorderList from "./ReorderList";

afterEach(() => { cleanup(); vi.useRealTimers(); });

// One drag of the row at `from`, dropped at the bottom. jsdom gives every row
// a zero-height rect, so the drop target resolves to the last row.
function dragToEnd(container: HTMLElement, from: number) {
  const handle = container.querySelectorAll(".drag-handle")[from]!;
  fireEvent.pointerDown(handle, { clientY: 0 });
  act(() => { window.dispatchEvent(Object.assign(new Event("pointermove"), { clientY: 500 })); });
  act(() => { window.dispatchEvent(new Event("pointerup")); });
}

// SHELL-F-01 (2026-09-05): the list must paint a changed id set in the same
// render it arrives in. It used to resync in an effect, one render late, so
// a caller that dropped an id saw renderRow called with it once, and any
// renderRow that looked the id up crashed the page.
describe("ReorderList", () => {
  it("never calls renderRow with an id the caller has removed", () => {
    const seen: string[][] = [];
    const rowsOf = (ids: string[]) => (
      <ReorderList
        ids={ids}
        onReorder={() => {}}
        renderRow={(id) => {
          seen.push(ids);
          if (!ids.includes(id)) throw new Error("renderRow got a stale id: " + id);
          return <span>{id}</span>;
        }}
      />
    );
    const { rerender, container } = render(rowsOf(["a", "b", "c"]));
    expect(container.textContent).toBe("abc");
    rerender(rowsOf(["a", "c"]));
    expect(container.textContent).toBe("ac");
  });

  it("keeps the caller's order when the same ids come back in a new array", () => {
    const rowsOf = (ids: string[]) => (
      <ReorderList ids={ids} onReorder={() => {}} renderRow={(id) => <span>{id}</span>} />
    );
    const { rerender, container } = render(rowsOf(["a", "b"]));
    rerender(rowsOf(["a", "b"]));
    expect(container.textContent).toBe("ab");
    rerender(rowsOf(["b", "a"]));
    expect(container.textContent).toBe("ba");
  });

  // SHELL-F-11 (2026-09-05): the stored order does not change when the write
  // fails, so the caller's ids prop does not change either, so nothing ever
  // put the rows back. The dragged order sat there looking saved until the
  // next visit.
  it("puts the rows back when the caller says the new order was not saved", async () => {
    const { container } = render(
      <ReorderList ids={["a", "b", "c"]} onReorder={async () => false} renderRow={(id) => <span>{id}</span>} />,
    );
    dragToEnd(container, 0);
    expect(container.textContent).toBe("bca");
    await waitFor(() => expect(container.textContent).toBe("abc"));
  });

  it("keeps the new order when the caller says nothing, exactly as before", async () => {
    const seen: string[][] = [];
    const { container } = render(
      <ReorderList ids={["a", "b", "c"]} onReorder={(next) => { seen.push(next); }} renderRow={(id) => <span>{id}</span>} />,
    );
    dragToEnd(container, 0);
    expect(seen).toEqual([["b", "c", "a"]]);
    await waitFor(() => expect(container.textContent).toBe("bca"));
  });
});

// ONE MENU, THREE DOORS (BROWSER-F-14 + SHELL-F-22, merged 2026-09-05).
//
// Reordering was a pointer drag on the grip and nothing else, so a person who
// never finds the grip, or cannot hold a drag steady, had no way to move a row
// at all. The grip itself declared role="button" and aria-label="Reorder" and
// answered only a drag, so tapping it did nothing, and tabIndex -1 kept every
// keyboard and switch control out of tab order.
//
// A tap on the grip, Enter or Space on the grip, and a long press on the row
// all open the SAME shared RowActionSheet, and every pick goes through the
// same commit the drag uses.
describe("BROWSER-F-14 + SHELL-F-22: Move Up and Move Down without the drag", () => {
  const list = (
    onReorder: (n: string[]) => void | Promise<boolean | void> = () => {},
    ids = ["a", "b", "c"],
  ) => render(
    <ReorderList ids={ids} onReorder={onReorder} renderRow={(id) => <span>{id}</span>} />,
  );
  const handles = () => [...document.querySelectorAll<HTMLElement>(".drag-handle")];
  const sheet = () => document.querySelector(".sheet-scrim");
  const item = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(".sheet-scrim button")].find((b) => b.textContent === label)!;
  // A tap is a pointerdown and a pointerup that never travelled.
  const tap = (el: HTMLElement) => {
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
  };
  // A hold is a touch that stays put for the long-press interval.
  const holdRow = (container: HTMLElement, i: number) => {
    const row = container.querySelectorAll(".reorder-row")[i]!;
    fireEvent.touchStart(row, { touches: [{ clientX: 5, clientY: 5 }] });
    act(() => { vi.advanceTimersByTime(500); });
  };

  it("the handle is reachable by Tab and says it opens a menu", () => {
    list();
    const h = handles()[0]!;
    expect(h.getAttribute("tabindex"), "tabIndex -1 was why no keyboard could reorder").toBe("0");
    expect(h.getAttribute("aria-haspopup")).toBe("menu");
    expect(h.getAttribute("aria-expanded")).toBe("false");
  });

  it("a tap on the handle opens the sheet instead of doing nothing", () => {
    list();
    expect(sheet()).toBeNull();
    tap(handles()[1]!);
    expect(sheet(), "the dead tap is gone").toBeTruthy();
    expect(item("Move Up")).toBeTruthy();
    expect(item("Move Down")).toBeTruthy();
    expect(handles()[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("Enter on the handle opens it too", () => {
    list();
    fireEvent.keyDown(handles()[1]!, { key: "Enter" });
    expect(sheet()).toBeTruthy();
  });

  it("a long press on the row opens the same sheet", () => {
    vi.useFakeTimers();
    const { container } = list();
    holdRow(container, 1);
    expect(sheet(), "the grip is not the only way in").toBeTruthy();
    expect(item("Move Up")).toBeTruthy();
    expect(item("Move Down")).toBeTruthy();
  });

  // The point of the merge: one component, not a popover for the handle and a
  // sheet for the hold.
  it("there is only one menu behind both doors", () => {
    vi.useFakeTimers();
    const { container } = list();
    holdRow(container, 1);
    expect(document.querySelectorAll(".sheet-scrim").length).toBe(1);
    expect(document.querySelector(".hmenu"), "the second menu is gone").toBeNull();
  });

  it("Move Up and Move Down reorder the list and tell the caller", () => {
    const onReorder = vi.fn();
    const { container } = list(onReorder);
    tap(handles()[2]!);
    fireEvent.click(item("Move Up"));
    expect(onReorder).toHaveBeenCalledWith(["a", "c", "b"]);
    expect(container.textContent).toContain("acb");
    expect(sheet(), "picking closes the sheet").toBeNull();
  });

  it("a long press move writes the new order, exactly as the handle does", () => {
    vi.useFakeTimers();
    const seen: string[][] = [];
    const { container } = list((next) => { seen.push(next); });
    holdRow(container, 1);
    fireEvent.click(item("Move Up"));
    expect(seen).toEqual([["b", "a", "c"]]);
    expect(container.textContent).toBe("bac");
    expect(sheet(), "the sheet closes behind the choice").toBeNull();
  });

  it("the ends cannot move past themselves", () => {
    list();
    tap(handles()[0]!);
    expect(item("Move Up")).toBeDisabled();
    expect(item("Move Down")).not.toBeDisabled();
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    tap(handles()[2]!);
    expect(item("Move Down")).toBeDisabled();
  });

  it("the first row of a pair is offered no move up, and the last no move down", () => {
    vi.useFakeTimers();
    const { container } = list(() => {}, ["a", "b"]);
    holdRow(container, 0);
    expect(item("Move Up")).toBeDisabled();
    expect(item("Move Down")).not.toBeDisabled();
  });

  // SHELL-F-11 again, through the other door: a menu move and a drag share one
  // commit, so a refused write puts the rows back the same way.
  it("a move the caller refuses goes back, like a refused drag", async () => {
    vi.useFakeTimers();
    const { container } = list(async () => false);
    holdRow(container, 2);
    fireEvent.click(item("Move Up"));
    expect(container.textContent).toBe("acb");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toBe("abc");
  });

  // The gesture the handle already had has to survive the tap that was added
  // to it: a press that TRAVELLED is still a drag and still commits.
  it("a drag still reorders and does not open the sheet", () => {
    const onReorder = vi.fn();
    list(onReorder);
    fireEvent.pointerDown(handles()[0]!, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(sheet(), "a drag is not a tap").toBeNull();
    expect(onReorder).toHaveBeenCalled();
  });
});
