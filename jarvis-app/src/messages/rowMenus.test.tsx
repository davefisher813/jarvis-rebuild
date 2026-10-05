// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailSwipe from "./MailSwipe";
import LetGoSwipe from "./LetGoSwipe";

// LONG PRESS IS THE ROW'S CONTEXT MENU (Dave 2026-10-05, locked). A mail row and a Waiting On row open a RowActionSheet on a
// hold, listing what their rail lists (and, for a waiting row, what its More sheet holds), destructive last.
const hold = (el: Element) => { fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] }); act(() => { vi.advanceTimersByTime(520); }); };
const menu = () => Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
const noop = () => {};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a mail row: a hold lists Later, Archive, Delete", () => {
  it("a Needs You row carries Later; Delete is last and destructive; the rail stays shut", () => {
    vi.useFakeTimers();
    const onArchive = vi.fn();
    const { container } = render(<MailSwipe label="Wei Chen" onArchive={onArchive} onDelete={noop} onLater={noop}><div className="row">Wei Chen</div></MailSwipe>);
    hold(container.querySelector(".task-row")!);
    expect(menu()).toEqual(["Later", "Archive", "Delete", "Cancel"]);
    expect(document.querySelector(".action-sheet .destructive")!.textContent).toBe("Delete");
    expect(document.querySelector(".sheet-scrim .eyebrow")!.textContent).toBe("Wei Chen");
    expect((container.querySelector(".task-row") as HTMLElement).style.transform).toBe("");
    fireEvent.click(screen.getByText("Archive", { selector: ".action-sheet button" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("any other mail row lists Archive and Delete", () => {
    const { container } = render(<MailSwipe label="Wei Chen" onArchive={noop} onDelete={noop}><div className="row">Wei Chen</div></MailSwipe>);
    fireEvent.contextMenu(container.querySelector(".task-row")!);
    expect(menu()).toEqual(["Archive", "Delete", "Cancel"]);
  });
});

describe("a Waiting On row: a hold lists More Moves and Let Go, or the caller's whole list", () => {
  it("defaults to the rail's own two", () => {
    vi.useFakeTimers();
    const onLetGo = vi.fn();
    const { container } = render(<LetGoSwipe label="Wei Chen" onMore={noop} onLetGo={onLetGo}><div className="row">Wei</div></LetGoSwipe>);
    hold(container.querySelector(".task-row")!);
    expect(menu()).toEqual(["More Moves", "Let Go", "Cancel"]);
    expect((container.querySelector(".task-row") as HTMLElement).style.transform).toBe("");
    fireEvent.click(screen.getByText("Let Go", { selector: ".action-sheet button" }));
    expect(onLetGo).toHaveBeenCalledTimes(1);
  });

  it("lists the row's own ask and every alternate when the caller passes them (what the More sheet holds)", () => {
    vi.useFakeTimers();
    const ask = vi.fn();
    const { container } = render(
      <LetGoSwipe label="Wei Chen" onMore={noop} onLetGo={noop} menu={[{ label: "Nudge Wei", onPick: ask }, { label: "Call Wei", onPick: noop }, { label: "Let Go", onPick: noop }]}>
        <div className="row">Wei</div>
      </LetGoSwipe>,
    );
    hold(container.querySelector(".task-row")!);
    expect(menu()).toEqual(["Nudge Wei", "Call Wei", "Let Go", "Cancel"]);
    fireEvent.click(screen.getByText("Nudge Wei"));
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
