// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DayRow from "./DayRow";
import type { EventItem } from "../types";

// The swipe actions on this row had NO test coverage at all before 2026-08-07,
// which is part of how they stayed touch-only and invisible for so long.

const ev = (over: Partial<EventItem["data"]> = {}): EventItem => ({
  id: "e1",
  data: { title: "Client Call", start: "10:00", end: "11:00", date: "2026-05-26", category: "c1", ...over },
} as EventItem);

const render1 = (over: Partial<EventItem["data"]> = {}, props: Record<string, unknown> = {}) => {
  const onPush15 = vi.fn();
  const onPushTomorrow = vi.fn();
  const onOpen = vi.fn();
  render(
    <DayRow e={ev(over)} conflict={false} isNext={false} isPast={false} now={null}
      onOpen={onOpen} onPush15={onPush15} onPushTomorrow={onPushTomorrow} {...props} />,
  );
  return { onPush15, onPushTomorrow, onOpen };
};

describe("DayRow quick actions", () => {
  it("advertises the actions with a control, instead of hiding them behind a gesture", () => {
    render1();
    const grip = screen.getByLabelText("Quick actions");
    expect(grip).toBeInTheDocument();
    expect(grip).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals and fires Push 15 without any touch event, which the swipe could not", () => {
    const { onPush15 } = render1();
    fireEvent.click(screen.getByLabelText("Quick actions"));
    expect(screen.getByLabelText("Hide quick actions")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("+15 min"));
    expect(onPush15).toHaveBeenCalled();
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

  it("stays out of the way where the swipe was already refused: recurring series", () => {
    render1({ recurrence: "weekly" });
    expect(screen.queryByLabelText("Quick actions")).not.toBeInTheDocument();
  });

  it("and on past events", () => {
    render(<DayRow e={ev()} conflict={false} isNext={false} isPast now={null} onOpen={() => {}} onPush15={() => {}} onPushTomorrow={() => {}} />);
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
});
