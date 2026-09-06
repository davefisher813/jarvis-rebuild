// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useSwipe } from "./useSwipe";

// UP-CORE-15 (2026-09-05): the clamp was [-revealW, 0] since this file was
// written, so no right swipe existed anywhere in the app. The right half is
// deliberately not a second reveal: there is nothing to choose, so the row
// follows the finger and releasing past half fires the one action.
function Row({ onRightCommit, rightW = 88 }: { onRightCommit?: () => void; rightW?: number }) {
  const s = useSwipe({ revealW: 88, rightW, ...(onRightCommit ? { onRightCommit } : {}) });
  return <div data-testid="row" style={{ transform: `translateX(${s.dx}px)` }} {...s.handlers} />;
}

const swipe = (el: Element, to: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 100 + to, clientY: 100 }] });
  fireEvent.touchEnd(el);
};

describe("useSwipe: the right half", () => {
  it("fires past half the travel and snaps back", () => {
    const onRightCommit = vi.fn();
    const { getByTestId } = render(<Row onRightCommit={onRightCommit} />);
    const row = getByTestId("row");
    swipe(row, 60);
    expect(onRightCommit).toHaveBeenCalledTimes(1);
    // Snapped back: the action IS the feedback, there is nothing revealed.
    expect(row.style.transform).toBe("translateX(0px)");
  });

  it("does nothing short of half", () => {
    const onRightCommit = vi.fn();
    const { getByTestId } = render(<Row onRightCommit={onRightCommit} />);
    swipe(getByTestId("row"), 30);
    expect(onRightCommit).not.toHaveBeenCalled();
  });

  it("a row with no right action cannot move right at all", () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId("row");
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 200, clientY: 100 }] });
    expect(row.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(row);
  });

  it("the left reveal still opens, and is unaffected", () => {
    const onRightCommit = vi.fn();
    const { getByTestId } = render(<Row onRightCommit={onRightCommit} />);
    const row = getByTestId("row");
    swipe(row, -60);
    expect(row.style.transform).toBe("translateX(-88px)");
    expect(onRightCommit).not.toHaveBeenCalled();
  });

  it("closing an open row does not also complete it", () => {
    const onRightCommit = vi.fn();
    const { getByTestId } = render(<Row onRightCommit={onRightCommit} />);
    const row = getByTestId("row");
    swipe(row, -60);            // open
    swipe(row, 60);             // swipe back right to close
    expect(onRightCommit).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateX(0px)");
  });
});
