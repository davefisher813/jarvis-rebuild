// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DayRow from "./DayRow";
import type { EventItem } from "../types";

// The swipe actions on this row had NO test coverage at all before 2026-08-07,
// which is part of how they stayed touch-only and invisible for so long.
//
// 2026-08-19 (Dave: "locked in stuff should be moveable with no issue"):
// repeating events used to be excluded from the actions entirely. They are
// not any more, and these tests pin that, plus the shift controls that
// finally let an event move EARLIER.

const ev = (over: Partial<EventItem["data"]> = {}): EventItem => ({
  id: "e1",
  data: { title: "Client Call", start: "10:00", end: "11:00", date: "2026-05-26", category: "c1", ...over },
} as EventItem);

const render1 = (over: Partial<EventItem["data"]> = {}, props: Record<string, unknown> = {}) => {
  const onShift = vi.fn();
  const onMoveTo = vi.fn();
  const onSkipToday = vi.fn();
  const onPushTomorrow = vi.fn();
  const onOpen = vi.fn();
  render(
    <DayRow e={ev(over)} conflict={false} isNext={false} isPast={false} now={null}
      onOpen={onOpen} onShift={onShift} onMoveTo={onMoveTo} onSkipToday={onSkipToday}
      onPushTomorrow={onPushTomorrow} {...props} />,
  );
  return { onShift, onMoveTo, onSkipToday, onPushTomorrow, onOpen };
};

describe("DayRow quick actions", () => {
  it("advertises the actions with a control, instead of hiding them behind a gesture", () => {
    render1();
    const grip = screen.getByLabelText("Quick actions");
    expect(grip).toBeInTheDocument();
    expect(grip).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals and fires a forward shift without any touch event, which the swipe could not", () => {
    const { onShift } = render1();
    fireEvent.click(screen.getByLabelText("Quick actions"));
    expect(screen.getByLabelText("Hide quick actions")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("+15m"));
    expect(onShift).toHaveBeenCalledWith(15);
  });

  it("can move an event EARLIER, which nothing in the app could do before", () => {
    const { onShift } = render1();
    fireEvent.click(screen.getByLabelText("Quick actions"));
    fireEvent.click(screen.getByText("−15m"));
    expect(onShift).toHaveBeenCalledWith(-15);
  });

  it("reaches Tomorrow the same way", () => {
    const { onPushTomorrow } = render1();
    fireEvent.click(screen.getByLabelText("Quick actions"));
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(onPushTomorrow).toHaveBeenCalled();
  });

  it("toggles shut again, and opening does not open the editor", () => {
    const { onOpen } = render1();
    const grip = screen.getByLabelText("Quick actions");
    fireEvent.click(grip);
    expect(onOpen).not.toHaveBeenCalled(); // the row's own tap must not fire
    fireEvent.click(screen.getByLabelText("Hide quick actions"));
    expect(screen.getByLabelText("Quick actions")).toHaveAttribute("aria-expanded", "false");
  });

  it("LAW: a repeating event is movable, and offers Skip Today instead of Tomorrow", () => {
    const { onShift, onSkipToday } = render1({ recurrence: "weekly" });
    fireEvent.click(screen.getByLabelText("Quick actions"));
    fireEvent.click(screen.getByText("+15m"));
    expect(onShift).toHaveBeenCalledWith(15);
    // Tomorrow would move the whole series' anchor; skipping one day cannot.
    expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip Today"));
    expect(onSkipToday).toHaveBeenCalled();
  });

  it("stays out of the way on past events", () => {
    render(<DayRow e={ev()} conflict={false} isNext={false} isPast now={null} onOpen={() => {}} onShift={() => {}} onPushTomorrow={() => {}} />);
    expect(screen.queryByLabelText("Quick actions")).not.toBeInTheDocument();
  });

  it("is absent when the row has no actions to offer", () => {
    render(<DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} />);
    expect(screen.queryByLabelText("Quick actions")).not.toBeInTheDocument();
  });

  it("still opens the editor on a normal row tap", () => {
    const { onOpen } = render1();
    fireEvent.click(screen.getByText("Client Call"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("tapping the TIME changes just the time, without opening the editor", () => {
    const { onMoveTo, onOpen } = render1();
    fireEvent.click(screen.getByLabelText("Change time or length, currently 10:00 AM"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New time"), { target: { value: "14:30" } });
    expect(onMoveTo).toHaveBeenCalledWith("14:30");
  });
});

// B3/B5 (2026-08-23): the row could change WHEN an event is from two separate
// controls and could not change how LONG it is from any of them.
describe("DayRow resize", () => {
  const withEnd = (props: Record<string, unknown> = {}, over: Partial<EventItem["data"]> = {}) => {
    const onSetEnd = vi.fn();
    const onOpen = vi.fn();
    render(
      <DayRow e={ev(over)} conflict={false} isNext={false} isPast={false} now={null}
        onOpen={onOpen} onSetEnd={onSetEnd} {...props} />,
    );
    return { onSetEnd, onOpen };
  };

  // AMENDED 2026-09-02 (A Cleaner Top, picked "In the one grey meta line"):
  // the length is the SPAN now, not the end time. "Until 11:00 AM" made
  // every row do arithmetic to answer "how long is this"; "1h" answers it.
  it("turns the length into a control instead of leaving it as text, and states the span", () => {
    withEnd();
    const btn = screen.getByLabelText("Change length, currently 60 minutes");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveTextContent("1h");
    expect(btn).not.toHaveTextContent("Until");
  });

  it("stays plain text when the row has no way to resize", () => {
    render(<DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} />);
    expect(screen.queryByLabelText(/Change length/)).toBeNull();
    expect(screen.getByText("1h")).toBeInTheDocument();
  });

  // THE RED CAPSULE IS GONE (A Cleaner Top): a block with no end wore a
  // "Set Length" accent capsule on nearly every row of the day. A blank
  // field is not a verb, and red is a verb here. The row says nothing, and
  // the length is set from the time popover, which now carries both halves.
  it("says nothing about a length the block does not have", () => {
    withEnd({}, { end: undefined });
    expect(screen.queryByText("Set Length")).toBeNull();
    expect(screen.queryByLabelText(/Change length/)).toBeNull();
  });

  it("the time popover sets the length as well as the time", () => {
    const onMoveTo = vi.fn();
    const { onSetEnd } = withEnd({ onMoveTo }, { end: undefined });
    fireEvent.click(screen.getByLabelText("Change time or length, currently 10:00 AM"));
    expect(screen.getByText("How Long")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Client Call: 45 minutes"));
    expect(onSetEnd).toHaveBeenCalledWith("10:45");
    expect(onMoveTo).not.toHaveBeenCalled();
  });

  // The place is a fact on the same grey line, not an accent link on one of
  // its own: two reds per row for a blank field and an address was the
  // whole complaint.
  it("the place joins the meta line, quiet", () => {
    const { container } = render(<DayRow e={ev({ location: "Ridgeline Fields" })} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} />);
    const loc = container.querySelector(".sched-cat .sched-loc");
    expect(loc).toHaveTextContent("Ridgeline Fields");
    expect(container.querySelector(".sched-body > .sched-loc")).toBeNull();
  });

  it("sends back an END time, not a duration, and does not open the editor", () => {
    const { onSetEnd, onOpen } = withEnd();
    fireEvent.click(screen.getByLabelText("Change length, currently 60 minutes"));
    fireEvent.click(screen.getByLabelText("Client Call: 90 minutes"));
    expect(onSetEnd).toHaveBeenCalledWith("11:30");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks the length the event already has, so the popover says where you are", () => {
    withEnd();
    fireEvent.click(screen.getByLabelText("Change length, currently 60 minutes"));
    expect(screen.getByLabelText("Client Call: 60 minutes").className).toContain("chip-on");
    expect(screen.getByLabelText("Client Call: 90 minutes").className).not.toContain("chip-on");
  });

  // The one that would sort an event to the top of the morning.
  it("clamps a block stretched past midnight instead of wrapping it", () => {
    const { onSetEnd } = withEnd({}, { start: "23:00", end: "23:30" });
    fireEvent.click(screen.getByLabelText(/Change length/));
    fireEvent.click(screen.getByLabelText("Client Call: 120 minutes"));
    expect(onSetEnd).toHaveBeenCalledWith("23:59");
  });
});

// S6-Q36 (2026-09-04): "the first move is thrown away, never stored." The
// event row is one of the two places it gets to render again, resolved by
// the caller (schedule/attachments.ts's firstMoveOf) and handed in as a
// plain prop, same shape as attach.
describe("DayRow: the first move (S6-Q36)", () => {
  it("joins the one grey meta line when the caller resolves one", () => {
    const { container } = render(
      <DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} firstMove="Open the invoice template" />,
    );
    const move = container.querySelector(".sched-cat .sched-firstmove");
    expect(move).toHaveTextContent("Open the invoice template");
  });

  it("renders nothing when the caller resolves none", () => {
    const { container } = render(
      <DayRow e={ev()} conflict={false} isNext={false} isPast={false} now={null} onOpen={() => {}} />,
    );
    expect(container.querySelector(".sched-firstmove")).toBeNull();
  });
});
