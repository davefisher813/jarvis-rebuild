// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useLongPress } from "./useLongPress";

// The three failure modes this primitive exists to avoid are all things that
// only show up on a phone, so they are the things worth pinning here: a
// scroll must not fire it, the click after it must not get through, and a
// timer must not outlive the component.

function Probe({ onLongPress, onClick, ms, enabled }: {
  onLongPress: () => void; onClick?: () => void; ms?: number; enabled?: boolean;
}) {
  const lp = useLongPress({ onLongPress, ...(ms != null ? { ms } : {}), ...(enabled != null ? { enabled } : {}) });
  return <div data-testid="row" onClick={onClick} {...lp}>row</div>;
}

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLongPress", () => {
  it("fires after the hold", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    fireEvent.touchStart(getByTestId("row"), touch(10, 10));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a quick tap", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.touchEnd(row);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  // Without this, every flick down a long list renames whatever your finger
  // happened to land on.
  it("a scroll is not a press", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.touchMove(row, touch(10, 60));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("a small wobble is still a press, because fingers are not styluses", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    fireEvent.touchMove(row, touch(13, 14));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  // The bug this whole primitive exists to fix, in miniature: two things
  // happening on one gesture.
  it("swallows the click that a touch device synthesises afterwards", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} onClick={onClick} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  // And it swallows exactly ONE. A row that stopped opening on every tap
  // after a single long press would be a worse bug than the one being fixed.
  it("swallows one click and no more", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} onClick={onClick} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a normal tap through untouched", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={vi.fn()} onClick={onClick} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when disabled", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} onClick={onClick} enabled={false} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.click(row);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // A touch fires BOTH touch and pointer events. Starting the timer from
  // each would run the callback twice.
  it("does not double-fire when a touch also raises pointer events", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, touch(10, 10));
    fireEvent.pointerDown(row, { pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("works with a mouse, for anyone not on a phone", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Probe onLongPress={onLongPress} />);
    fireEvent.pointerDown(getByTestId("row"), { pointerType: "mouse", clientX: 5, clientY: 5 });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("calls the LATEST callback, not the one captured when the press began", () => {
    const first = vi.fn(); const second = vi.fn();
    const { getByTestId, rerender } = render(<Probe onLongPress={first} />);
    fireEvent.touchStart(getByTestId("row"), touch(10, 10));
    rerender(<Probe onLongPress={second} />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running after unmount", () => {
    const onLongPress = vi.fn();
    const { getByTestId, unmount } = render(<Probe onLongPress={onLongPress} />);
    fireEvent.touchStart(getByTestId("row"), touch(10, 10));
    unmount();
    act(() => { vi.advanceTimersByTime(800); });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
