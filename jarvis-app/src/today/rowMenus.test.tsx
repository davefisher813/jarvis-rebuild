// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import MoveHeadliner, { SwipeShell } from "./MoveHeadliner";
import RemindersStrip from "./RemindersStrip";
import RowShell from "../brain/RowShell";
import NoticeCard from "./NoticeCard";
import type { ReminderView } from "../tasks/reminders";

// LONG PRESS IS THE ROW'S CONTEXT MENU (Dave 2026-10-05, locked). On Today every swipeable row wears the one shell
// (SwipeShell), so a held row opens a RowActionSheet that lists what the tray lists (the quickest verb first), then the
// right swipe's action, destructive last. Never the only way to anything: the tap's sheet and the tray hold the same lines.
const hold = (el: Element) => { fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] }); act(() => { vi.advanceTimersByTime(520); }); };
const menu = () => Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
const noop = () => {};
const rv = (id: string, time: string): ReminderView => ({ id, text: id.replace(/-/g, " "), time, unscheduled: false, paused: false, category: "", done: false, missed: false, snoozed: false, letGo: false });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Your Move: a held row opens its menu", () => {
  it("ready to work: Start Now, Tomorrow, then Done (the right swipe), titled with the task", () => {
    vi.useFakeTimers();
    const { container } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onStart={noop} onTomorrow={noop} onToggle={noop} />);
    hold(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Start Now", "Tomorrow", "Done", "Cancel"]);
    expect(document.querySelector(".sheet-scrim .eyebrow")!.textContent).toBe("Call Bank");
    expect((container.querySelector(".notice-card") as HTMLElement).style.transform, "the tray stays shut").toBe("");
  });

  it("a block running: Wrap Up, Stop; picking a line runs it", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const { container, getByText } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onDone={noop} onStop={onStop} />);
    hold(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Wrap Up", "Stop", "Cancel"]);
    fireEvent.click(getByText("Stop", { selector: ".action-sheet button" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("the context-menu event opens it too", () => {
    const { container } = render(<MoveHeadliner title="Call Bank" facts={{ urgency: null }} onStart={noop} />);
    fireEvent.contextMenu(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Start Now", "Cancel"]);
  });
});

describe("SwipeShell: the menu is the tray's lines with destructive last, or a caller's own", () => {
  it("sorts a destructive verb to the end and drops a right action the tray already holds", () => {
    vi.useFakeTimers();
    const { container } = render(
      <SwipeShell actions={[{ label: "Remove", run: noop, destructive: true }, { label: "Done", run: noop }]} onRight={noop}><div className="row">x</div></SwipeShell>,
    );
    hold(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Done", "Remove", "Cancel"]);
    expect(document.querySelector(".action-sheet .destructive")!.textContent).toBe("Remove");
  });

  it("a Brain or Health row (RowShell) with one verb holds a one-line menu; with none it is not swipeable and opens nothing", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { container, getByText } = render(<RowShell verb={{ label: "Pack It", run }}><div className="row">Window</div></RowShell>);
    hold(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Pack It", "Cancel"]);
    fireEvent.click(getByText("Pack It", { selector: ".action-sheet button" }));
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();
    const bare = render(<RowShell><div className="row">Nothing on File Yet</div></RowShell>);
    hold(bare.container.querySelector(".notice-card")!);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });

  it("a taking-it row (Took It, both ways) lists the verb once", () => {
    vi.useFakeTimers();
    const { container } = render(<RowShell verb={{ label: "Took It", run: noop }} onRight={noop} rightLabel="Took It"><div className="row">Meds</div></RowShell>);
    hold(container.querySelector(".notice-card")!);
    expect(menu()).toEqual(["Took It", "Cancel"]);
  });
});

describe("the Today reminders strip: a held reminder opens Snooze, Done, Delete", () => {
  it("lists them in that order with Delete last, and does not open the reminder", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onSnooze = vi.fn();
    const { container, getByText } = render(<RemindersStrip items={[rv("call-mum", "12:00")]} onTick={noop} onSnooze={onSnooze} onDelete={noop} onOpen={onOpen} />);
    hold(container.querySelector(".rem-row")!);
    expect(menu()).toEqual(["Snooze", "Done", "Delete", "Cancel"]);
    expect(document.querySelector(".sheet-scrim .eyebrow")!.textContent).toBe("Call Mum");
    expect((container.querySelector(".rem-row") as HTMLElement).style.transform).toBe("");
    fireEvent.click(getByText("Snooze", { selector: ".action-sheet button" }));
    expect(onSnooze).toHaveBeenCalledWith("call-mum");
  });

  it("without a Snooze or Delete wired it still offers Done", () => {
    vi.useFakeTimers();
    const { container } = render(<RemindersStrip items={[rv("call-mum", "12:00")]} onTick={noop} />);
    hold(container.querySelector(".rem-row")!);
    expect(menu()).toEqual(["Done", "Cancel"]);
  });
});

describe("a notice card's hold: the menu, or the tuning sheet for a producer's card", () => {
  it("a card that names its producer keeps the tuning sheet (and not the tray)", () => {
    vi.useFakeTimers();
    const { container } = render(<NoticeCard icon={<i />} title="Keep going" automation="momentum" onTune={noop} onDismiss={noop} />);
    hold(container.querySelector(".notice-card")!);
    expect(document.querySelector(".notice-tune")).toBeTruthy();
    expect(document.querySelector(".action-sheet")).toBeNull();
    expect((container.querySelector(".notice-card") as HTMLElement).style.transform, "the tray stays shut").toBe("");
  });

  it("a hold on a card that tunes still lets a swipe through: the tray opens by swiping, not by the hold", () => {
    const { container } = render(<NoticeCard icon={<i />} title="Keep going" automation="momentum" onTune={noop} onDismiss={noop} />);
    const card = container.querySelector(".notice-card")!;
    fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 10 }] });
    fireEvent.touchMove(card, { touches: [{ clientX: 100, clientY: 10 }] });
    fireEvent.touchEnd(card);
    expect((card as HTMLElement).style.transform, "the tune hold no longer clobbers the swipe").toBe("translateX(-88px)");
  });
});
