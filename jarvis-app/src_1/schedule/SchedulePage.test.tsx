// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SchedulePage from "./screens/SchedulePage";
import type { EventItem } from "./types";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([
  { id: "tucci", name: "Tucci", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "tucci" } });
const base = {
  year: 2026,
  month: 4, // May (0-based)
  selected: "2026-05-20",
  todayDate: "2026-05-20",
  dots: { 20: ["tucci"] } as Record<number, string[]>,
  dayEvents: [ev("a", "09:00")],
};

describe("SchedulePage", () => {
  it("renders the month grid (42 cells)", () => {
    const { container } = render(<SchedulePage {...base} />);
    expect(container.querySelector(".cal-grid")).toBeTruthy();
    expect(container.querySelectorAll(".cal-cell").length).toBe(42);
  });

  it("renders the selected day's timeline with category dot", () => {
    const { container } = render(<SchedulePage {...base} />);
    expect(container.querySelector(".sched-row")).toBeTruthy();
    expect(container.querySelector(".cat-dot.cat-bg-sky")).toBeTruthy();
  });

  it("shows an empty state on a day with no events", () => {
    const { container } = render(<SchedulePage {...base} dayEvents={[]} />);
    expect(container.querySelector(".empty-state")).toBeTruthy();
  });

  it("fires month navigation", () => {
    const onNext = vi.fn();
    const { container } = render(<SchedulePage {...base} onNext={onNext} />);
    const steps = container.querySelectorAll(".cal-step");
    fireEvent.click(steps[steps.length - 1] as HTMLElement);
    expect(onNext).toHaveBeenCalled();
  });
});
