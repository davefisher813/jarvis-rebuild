// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import GapSheet from "./GapSheet";
import SchedulePage from "./SchedulePage";
import type { GapOption } from "../gapOffer";

// SCHEDULE AUDIT 2026-10-01, item 7.
const opts: GapOption[] = [
  { id: "t1", text: "Call the dentist", category: "health", minutes: 15 },
  { id: "t2", text: "Update insurance docs", category: "money", minutes: 30 },
];
const sheet = (props: Record<string, unknown> = {}) => {
  const fns = { onBook: vi.fn(), onNewEvent: vi.fn(), onFocus: vi.fn(), onClose: vi.fn() };
  render(<GapSheet start="12:15" end="13:00" minutes={45} options={opts} {...fns} {...props} />);
  return fns;
};

describe("GapSheet", () => {
  it("says what the gap is and lists the tasks that fit", () => {
    sheet();
    expect(screen.getByText("Schedule Something Here")).toBeInTheDocument();
    expect(screen.getByText(/45 Min Open/)).toBeInTheDocument();
    expect(screen.getByText(/12:15 PM to 1:00 PM/)).toBeInTheDocument();
    expect(screen.getByText("Call the dentist")).toBeInTheDocument();
    expect(screen.getByText("Update insurance docs")).toBeInTheDocument();
  });

  it("one tap on Book hands over that option", () => {
    const { onBook } = sheet();
    fireEvent.click(screen.getByLabelText("Book Update insurance docs at 12:15 PM"));
    expect(onBook).toHaveBeenCalledWith(opts[1]);
  });

  it("the whole row books, as every row in the app is a door", () => {
    const { onBook } = sheet();
    fireEvent.click(screen.getByText("Call the dentist"));
    expect(onBook).toHaveBeenCalledWith(opts[0]);
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("keeps both old doors: New Event, and Focus", () => {
    const { onNewEvent, onFocus } = sheet();
    fireEvent.click(screen.getByText("New Event"));
    expect(onNewEvent).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Focus"));
    expect(onFocus).toHaveBeenCalled();
  });

  it("offers a door only when the caller has one", () => {
    sheet({ onFocus: undefined, onNewEvent: undefined });
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.queryByText("New Event")).toBeNull();
  });

  it("says so when nothing fits, and still offers the doors", () => {
    sheet({ options: [] });
    expect(screen.getByText("Nothing on your list fits this gap.")).toBeInTheDocument();
    expect(screen.getByText("New Event")).toBeInTheDocument();
  });

  it("a tap on the scrim closes it", () => {
    const { onClose } = sheet();
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("a tap on an Open row on the Schedule tab", () => {
  const day = {
    year: 2026, month: 9, selected: "2026-10-02", todayDate: "2026-10-01",
    dots: {} as Record<number, string[]>, mode: "day" as const,
    dayEvents: [{ id: "e1", data: { title: "Board Call", date: "2026-10-02", start: "09:00", end: "10:00", category: "work" } }],
    windowStartMin: 8 * 60, windowEndMin: 12 * 60,
  };

  it("asks for the gap's window instead of opening a blank form", () => {
    const onGapOffer = vi.fn();
    const onPickSlot = vi.fn();
    const { container } = render(<SchedulePage {...day} onGapOffer={onGapOffer} onPickSlot={onPickSlot} />);
    const gap = [...container.querySelectorAll<HTMLElement>(".sched-gap")].find((g) => g.dataset.gapStart === "10:00")!;
    fireEvent.click(gap);
    expect(onGapOffer).toHaveBeenCalledWith("10:00", "12:00");
    expect(onPickSlot).not.toHaveBeenCalled();
  });

  it("without the offer wired it still opens New Event at the gap, as it did", () => {
    const onPickSlot = vi.fn();
    const { container } = render(<SchedulePage {...day} onPickSlot={onPickSlot} />);
    const gap = [...container.querySelectorAll<HTMLElement>(".sched-gap")].find((g) => g.dataset.gapStart === "10:00")!;
    fireEvent.click(gap);
    expect(onPickSlot).toHaveBeenCalledWith("10:00");
  });
});
