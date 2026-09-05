// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoticeCard from "./NoticeCard";

// THE DELETE SLOT (2026-08-26). Dave, off a real screenshot of a mail
// notice's swipe reveal: "I should be able to delete from here." Dismiss
// already lived on the swipe and only ever hid the CARD; the mail stayed in
// the inbox. onDelete is a third, genuinely destructive action, and unlike
// Dismiss/alt (which were always at most two, with one hardcoded
// "beside-dismiss" offset covering that one pairing) a mail notice can now
// carry all three at once. These tests prove the offsets are computed
// correctly for every combination, not just the one that shipped first.

const base = {
  icon: <span />,
  title: "A notice",
};

describe("NoticeCard: the delete slot", () => {
  it("renders no reveal buttons when nothing is passed", () => {
    const { container } = render(<NoticeCard {...base} />);
    expect(container.querySelector(".notice-delete")).toBeNull();
    expect(container.querySelector(".notice-dismiss")).toBeNull();
    expect(container.querySelector(".notice-alt")).toBeNull();
  });

  it("Delete alone sits flush at the edge (right: 0, via the CSS default)", () => {
    const { container } = render(<NoticeCard {...base} onDelete={() => {}} />);
    const del = container.querySelector(".notice-delete") as HTMLElement;
    expect(del).not.toBeNull();
    expect(del.style.right).toBe("");
  });

  it("Delete stays outermost (right: 0) even with Dismiss and alt both present", () => {
    const { container } = render(
      <NoticeCard
        {...base}
        onDelete={() => {}}
        onDismiss={() => {}}
        alt={{ label: "Snooze", onClick: () => {} }}
      />,
    );
    const del = container.querySelector(".notice-delete") as HTMLElement;
    const dismiss = container.querySelector(".notice-dismiss") as HTMLElement;
    const alt = container.querySelector(".notice-alt") as HTMLElement;
    expect([del, dismiss, alt].every(Boolean)).toBe(true);
    // Delete is checked first in the slot order, so it always claims 0
    // regardless of what else is present -- the one the MailSwipe reveal
    // itself uses for Delete, so a swipe reads the same everywhere.
    expect(del.style.right).toBe("");
    // Dismiss and alt take the next two 88px slots, in that order, and must
    // not collide with Delete or each other.
    const dismissRight = Number(dismiss.style.right.replace("px", ""));
    const altRight = Number(alt.style.right.replace("px", ""));
    expect(dismissRight).toBe(88);
    expect(altRight).toBe(176);
  });

  it("Dismiss and alt still find distinct slots with no Delete present (the old two-button case)", () => {
    const { container } = render(
      <NoticeCard {...base} onDismiss={() => {}} alt={{ label: "Snooze", onClick: () => {} }} />,
    );
    const dismiss = container.querySelector(".notice-dismiss") as HTMLElement;
    const alt = container.querySelector(".notice-alt") as HTMLElement;
    expect(dismiss.style.right).toBe("");
    expect(Number(alt.style.right.replace("px", ""))).toBe(88);
  });

  it("clicking Delete fires onDelete", () => {
    let fired = false;
    const { getByText } = render(<NoticeCard {...base} onDelete={() => { fired = true; }} />);
    getByText("Delete").click();
    expect(fired).toBe(true);
  });
});

// TODAY-F-23 (2026-09-05): every secondary action on Today lived behind a
// touch-only gesture, so on the web, with a mouse, or with a keyboard,
// Dismiss and Delete could not be reached at all. Same rail, three more ways
// in, and useSwipe.toggle (which existed and was wired to nothing) is what
// they all call.
import { vi, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";

const rail = (container: HTMLElement) => (container.querySelector(".notice-card") as HTMLElement).style.transform;

describe("NoticeCard: the reveal without a touchscreen", () => {
  afterEach(() => vi.useRealTimers());

  it("a right-click (or the iOS callout) opens the same rail", () => {
    const { container } = render(<NoticeCard {...base} onDismiss={() => {}} />);
    const card = container.querySelector(".notice-card")!;
    expect(rail(container)).toBe("");
    fireEvent.contextMenu(card);
    expect(rail(container)).toBe("translateX(-88px)");
    // And closes again, so it is a toggle, not a trap.
    fireEvent.contextMenu(card);
    expect(rail(container)).toBe("");
  });

  it("a long press with the mouse opens it; a quick click does not", () => {
    vi.useFakeTimers();
    const { container } = render(<NoticeCard {...base} onDismiss={() => {}} />);
    const card = container.querySelector(".notice-card")!;
    fireEvent.mouseDown(card);
    fireEvent.mouseUp(card);
    act(() => { vi.advanceTimersByTime(600); });
    expect(rail(container)).toBe("");
    fireEvent.mouseDown(card);
    act(() => { vi.advanceTimersByTime(600); });
    expect(rail(container)).toBe("translateX(-88px)");
  });

  it("tabbing onto Dismiss opens the rail around it", () => {
    const { container, getByText } = render(<NoticeCard {...base} onDismiss={() => {}} />);
    fireEvent.focus(getByText("Dismiss"));
    expect(rail(container)).toBe("translateX(-88px)");
  });

  it("focus on the card's own action leaves the rail shut", () => {
    const { container, getByText } = render(
      <NoticeCard {...base} onDismiss={() => {}} action={{ label: "Plan", onClick: () => {} }} />,
    );
    fireEvent.focus(getByText("Plan"));
    expect(rail(container)).toBe("");
  });
});
