// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReorderList from "./ReorderList";

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

// BROWSER-F-14 (2026-09-05), option B. The handle declared role="button" and
// aria-label="Reorder" and did nothing at all when tapped: a dead tap on a
// control that promises to be a button. It also carried tabIndex -1, so with a
// switch control or a keyboard there was no way to change tab order in the app
// at all. A tap opens Move Up / Move Down; drag is untouched.
describe("BROWSER-F-14: tapping the reorder handle offers Move Up and Move Down", () => {
  const list = (onReorder: (n: string[]) => void = () => {}) => render(
    <ReorderList ids={["a", "b", "c"]} onReorder={onReorder} renderRow={(id) => <span>{id}</span>} />,
  );
  const handles = () => [...document.querySelectorAll<HTMLElement>(".drag-handle")];
  const item = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(".hmenu-item")].find((b) => b.textContent === label)!;
  // A tap is a pointerdown and a pointerup that never travelled.
  const tap = (el: HTMLElement) => {
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
  };

  afterEach(cleanup);

  it("the handle is reachable by Tab and says it opens a menu", () => {
    list();
    const h = handles()[0]!;
    expect(h.getAttribute("tabindex"), "tabIndex -1 was why no keyboard could reorder").toBe("0");
    expect(h.getAttribute("aria-haspopup")).toBe("menu");
    expect(h.getAttribute("aria-expanded")).toBe("false");
  });

  it("a tap opens the menu instead of doing nothing", () => {
    list();
    expect(document.querySelector(".hmenu")).toBeNull();
    tap(handles()[1]!);
    expect(document.querySelector(".hmenu"), "the dead tap is gone").toBeTruthy();
    expect(item("Move Up")).toBeTruthy();
    expect(item("Move Down")).toBeTruthy();
  });

  it("Enter on the handle opens it too", () => {
    list();
    fireEvent.keyDown(handles()[1]!, { key: "Enter" });
    expect(document.querySelector(".hmenu")).toBeTruthy();
  });

  it("Move Up and Move Down reorder the list and tell the caller", () => {
    const onReorder = vi.fn();
    const { container } = list(onReorder);
    tap(handles()[2]!);
    fireEvent.click(item("Move Up"));
    expect(onReorder).toHaveBeenCalledWith(["a", "c", "b"]);
    expect(container.textContent).toContain("acb");
    expect(document.querySelector(".hmenu"), "picking closes the menu").toBeNull();
  });

  it("the ends cannot move past themselves", () => {
    list();
    tap(handles()[0]!);
    expect(item("Move Up")).toBeDisabled();
    expect(item("Move Down")).not.toBeDisabled();
    fireEvent.click(document.querySelector(".hmenu-scrim")!);
    tap(handles()[2]!);
    expect(item("Move Down")).toBeDisabled();
  });

  // The gesture the handle already had has to survive the tap that was added
  // to it: a press that TRAVELLED is still a drag and still commits.
  it("a drag still reorders and does not open the menu", () => {
    const onReorder = vi.fn();
    list(onReorder);
    fireEvent.pointerDown(handles()[0]!, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(document.querySelector(".hmenu"), "a drag is not a tap").toBeNull();
    expect(onReorder).toHaveBeenCalled();
  });
});
