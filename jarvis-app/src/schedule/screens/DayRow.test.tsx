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

  it("LAW: a repeating event is movable, and offers Skip today instead of Tomorrow", () => {
    const { onShift, onSkipToday } = render1({ recurrence: "weekly" });
    fireEvent.click(screen.getByLabelText("Quick actions"));
    fireEvent.click(screen.getByText("+15m"));
    expect(onShift).toHaveBeenCalledWith(15);
    // Tomorrow would move the whole series' anchor; skipping one day cannot.
    expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip today"));
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
    fireEvent.click(screen.getByLabelText("Change time, currently 10:00 AM"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New time"), { target: { value: "14:30" } });
    expect(onMoveTo).toHaveBeenCalledWith("14:30");
  });
});
