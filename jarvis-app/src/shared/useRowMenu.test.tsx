// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useSwipe } from "./useSwipe";
import { useRowMenu } from "./useRowMenu";
import SwipeDelete from "./SwipeDelete";
import type { RowAction } from "./RowActionSheet";

// THE LONG PRESS IS THE CONTEXT MENU (Dave 2026-10-05, locked: "Long press: the context menu (RowActionSheet), never the only
// way to anything essential"). The hook is the one place a swipeable row gets its menu, so these are its contract: a held
// row opens the menu and NOT the tray, the click that ends the hold does not open the row, movement is a swipe not a hold,
// and a row with nothing to list keeps the old tray toggle (the keyboard-and-mouse way in).
const hold = (el: Element) => { fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] }); act(() => { vi.advanceTimersByTime(520); }); };
const sheet = () => Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);

function Row({ actions, onOpen, swipeEnabled = true, enabled = true }: { actions: RowAction[]; onOpen: () => void; swipeEnabled?: boolean; enabled?: boolean }) {
  const menu = useRowMenu({ title: "Call Bank", actions, enabled, swipeEnabled });
  const swipe = useSwipe({ revealW: 88, enabled: swipeEnabled, onLongPress: menu.onLongPress });
  const { handlers, sheet: s } = menu.bind(swipe);
  return (
    <div>
      <div data-testid="row" style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : "" }} {...handlers} onClick={onOpen}>Call Bank</div>
      {s}
    </div>
  );
}

const actions: RowAction[] = [{ label: "Start", onPick: vi.fn() }, { label: "Move to Tomorrow", onPick: vi.fn() }, { label: "Delete", destructive: true, onPick: vi.fn() }];

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useRowMenu: a held row opens its menu", () => {
  it("a hold lists the row's actions in order, with Cancel last, and leaves the tray shut", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} />);
    hold(getByTestId("row"));
    expect(sheet()).toEqual(["Start", "Move to Tomorrow", "Delete", "Cancel"]);
    expect(document.querySelector(".action-sheet .destructive")!.textContent).toBe("Delete");
    expect(getByTestId("row").style.transform, "the hold must not also slide the tray open").toBe("");
    expect(document.querySelector(".sheet-scrim .eyebrow")!.textContent, "the menu says which row it is about").toBe("Call Bank");
  });

  it("the context-menu event (right click, the iOS callout) opens the same menu", () => {
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} />);
    fireEvent.contextMenu(getByTestId("row"));
    expect(sheet()).toEqual(["Start", "Move to Tomorrow", "Delete", "Cancel"]);
    expect(getByTestId("row").style.transform).toBe("");
  });

  it("a mouse hold opens it too", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} />);
    fireEvent.mouseDown(getByTestId("row"));
    act(() => { vi.advanceTimersByTime(520); });
    expect(sheet()).toEqual(["Start", "Move to Tomorrow", "Delete", "Cancel"]);
  });

  it("picking a line runs it and closes the menu; Cancel closes it without running anything", () => {
    vi.useFakeTimers();
    const pick = vi.fn();
    const { getByTestId, getByText } = render(<Row actions={[{ label: "Start", onPick: pick }]} onOpen={() => {}} />);
    hold(getByTestId("row"));
    fireEvent.click(getByText("Start"));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    hold(getByTestId("row"));
    fireEvent.click(getByText("Cancel"));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });

  it("the click that ends the hold does not open the row; the next real tap does", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const { getByTestId } = render(<Row actions={actions} onOpen={onOpen} />);
    hold(getByTestId("row"));
    fireEvent.touchEnd(getByTestId("row"));
    fireEvent.click(getByTestId("row"));
    expect(onOpen, "a hold is not a tap").not.toHaveBeenCalled();
    fireEvent.touchStart(getByTestId("row"), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(getByTestId("row"));
    fireEvent.click(getByTestId("row"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("moving is a swipe, not a hold: no menu opens", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} />);
    const el = getByTestId("row");
    fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 10 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 40, clientY: 10 }] });
    act(() => { vi.advanceTimersByTime(700); });
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });

  it("a row with no actions keeps the controller's hold: the tray toggles (nothing else to open)", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={[]} onOpen={() => {}} />);
    hold(getByTestId("row"));
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(getByTestId("row").style.transform).toBe("translateX(-88px)");
  });

  it("a row whose swipe is switched off still opens its menu (the plain hold, and the context-menu event)", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} swipeEnabled={false} />);
    hold(getByTestId("row"));
    expect(sheet()).toEqual(["Start", "Move to Tomorrow", "Delete", "Cancel"]);
    cleanup();
    const again = render(<Row actions={actions} onOpen={() => {}} swipeEnabled={false} />);
    fireEvent.contextMenu(again.getByTestId("row"));
    expect(sheet()).toEqual(["Start", "Move to Tomorrow", "Delete", "Cancel"]);
  });

  it("a row in a mode where a hold means something else (select, rename) opens nothing", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Row actions={actions} onOpen={() => {}} enabled={false} />);
    hold(getByTestId("row"));
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});

describe("SwipeDelete: a held row is a menu with Delete last", () => {
  it("lists its own moves, then Delete; Delete runs the delete", () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    const open = vi.fn();
    const { getByText, container } = render(
      <SwipeDelete label="Push Day" onDelete={onDelete} menu={[{ label: "Open", onPick: open }]}><div className="row">Push Day</div></SwipeDelete>,
    );
    hold(container.querySelector(".swipe-row")!);
    expect(sheet()).toEqual(["Open", "Delete", "Cancel"]);
    expect((container.querySelector(".swipe-row") as HTMLElement).style.transform, "the tray stays shut").toBe("");
    fireEvent.click(getByText("Delete", { selector: ".action-sheet button" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a delete-only row is a menu of Delete alone", () => {
    vi.useFakeTimers();
    const { container } = render(<SwipeDelete label="Link Marco" onDelete={() => {}}><div className="row">Marco</div></SwipeDelete>);
    hold(container.querySelector(".swipe-row")!);
    expect(sheet()).toEqual(["Delete", "Cancel"]);
  });
});
