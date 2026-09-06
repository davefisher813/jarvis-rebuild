// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SchedulePage from "./screens/SchedulePage";
import type { EventItem } from "./types";
import { setCategoryRegistry } from "../shared/categories";
import { writeSnapshot, type WeatherSnapshot } from "../weather/weather";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });
const base = {
  year: 2026,
  month: 4, // May (0-based)
  selected: "2026-05-20",
  todayDate: "2026-05-20",
  dots: { 20: ["orgB"] } as Record<number, string[]>,
  dayEvents: [ev("a", "09:00")],
};

describe("SchedulePage", () => {
  it("renders the month grid (42 cells)", () => {
    const { container } = render(<SchedulePage {...base} />);
    expect(container.querySelector(".cal-grid")).toBeTruthy();
    expect(container.querySelectorAll(".cal-cell").length).toBe(42);
  });

  // SCHED-F-19 (2026-09-05). A day cell was a bare div with an onClick: no
  // role, no tab stop, no key handler, so a keyboard or a switch control could
  // not pick a day at all, on the one page where every other tappable row
  // already carried role="button" tabIndex={0}.
  describe("SCHED-F-19: the month grid can be used without a finger", () => {
    it("every cell announces as a button", () => {
      const { container } = render(<SchedulePage {...base} />);
      const cells = [...container.querySelectorAll(".cal-cell")];
      expect(cells.every((c) => c.getAttribute("role") === "button")).toBe(true);
    });

    it("a day in this month is a tab stop and a day outside it is not", () => {
      const { container } = render(<SchedulePage {...base} />);
      const inMonth = [...container.querySelectorAll(".cal-cell:not(.out)")];
      const outside = [...container.querySelectorAll(".cal-cell.out")];
      expect(inMonth.length).toBeGreaterThan(0);
      expect(outside.length, "May 2026 spills into April and June").toBeGreaterThan(0);
      expect(inMonth.every((c) => c.getAttribute("tabindex") === "0")).toBe(true);
      expect(outside.every((c) => c.getAttribute("tabindex") === "-1")).toBe(true);
    });

    for (const k of ["Enter", " "]) {
      it(`picks a day on ${k === " " ? "Space" : k}`, () => {
        const onSelect = vi.fn();
        const { container } = render(<SchedulePage {...base} onSelect={onSelect} />);
        fireEvent.keyDown(container.querySelectorAll(".cal-cell:not(.out)")[3]!, { key: k });
        expect(onSelect).toHaveBeenCalledTimes(1);
      });
    }

    it("a day outside the month picks nothing, by key or by tap", () => {
      const onSelect = vi.fn();
      const { container } = render(<SchedulePage {...base} onSelect={onSelect} />);
      const out = container.querySelector(".cal-cell.out")!;
      fireEvent.keyDown(out, { key: "Enter" });
      fireEvent.click(out);
      expect(onSelect).not.toHaveBeenCalled();
    });
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
    const steps = container.querySelectorAll(".sc-step");
    fireEvent.click(steps[steps.length - 1] as HTMLElement);
    expect(onNext).toHaveBeenCalled();
  });
});

// S6-Q41 (2026-09-05): "weather never reaches the Schedule tab." Today
// already carries it; this tab never passed a date to the row at all.
// weather.ts only ever fetches two days, so the fix is honest about that
// window rather than passing a date on every day and trusting the lookup to
// come back empty on the rest -- these prove the gate itself, not just the
// underlying forecast's own two-day limit, by seeding data for a day well
// outside the window too.
describe("SchedulePage: weather reaches the day view (S6-Q41)", () => {
  const TODAY = "2026-05-20";
  const TOMORROW = "2026-05-21";
  const FAR = "2026-05-25"; // has forecast data seeded, but is neither today nor tomorrow

  function seedRain(...dates: string[]): void {
    const time: string[] = [];
    const precipProb: number[] = [];
    for (const d of dates) {
      for (let h = 0; h < 24; h++) {
        time.push(`${d}T${String(h).padStart(2, "0")}:00`);
        precipProb.push(100);
      }
    }
    const snap: WeatherSnapshot = {
      fetchedAt: Date.now(),
      hourly: { time, tempF: Array(time.length).fill(72), precipProb, windMph: Array(time.length).fill(5) },
    };
    writeSnapshot(snap);
  }

  const withLocation = (id: string, date: string): EventItem => ({
    id, data: { title: id, date, start: "09:00", category: "orgB", location: "The Field" },
  });

  beforeEach(() => localStorage.clear());

  it("shows the weather line for today", () => {
    seedRain(TODAY, TOMORROW, FAR);
    const { container } = render(
      <SchedulePage {...base} selected={TODAY} todayDate={TODAY} dayEvents={[withLocation("a", TODAY)]} />,
    );
    expect(container.querySelector(".weather-inline")).toHaveTextContent(/Rain likely at start/);
  });

  it("shows the weather line for tomorrow too", () => {
    seedRain(TODAY, TOMORROW, FAR);
    const { container } = render(
      <SchedulePage {...base} selected={TOMORROW} todayDate={TODAY} dayEvents={[withLocation("a", TOMORROW)]} />,
    );
    expect(container.querySelector(".weather-inline")).toHaveTextContent(/Rain likely at start/);
  });

  it("stays silent past the two-day window, even though a forecast exists for it", () => {
    seedRain(TODAY, TOMORROW, FAR);
    const { container } = render(
      <SchedulePage {...base} selected={FAR} todayDate={TODAY} dayEvents={[withLocation("a", FAR)]} />,
    );
    expect(container.querySelector(".weather-inline")).toBeNull();
  });

  it("stays silent on an event with no location, same rule Today follows", () => {
    seedRain(TODAY);
    const noLoc: EventItem = { id: "a", data: { title: "a", date: TODAY, start: "09:00", category: "orgB" } };
    const { container } = render(
      <SchedulePage {...base} selected={TODAY} todayDate={TODAY} dayEvents={[noLoc]} />,
    );
    expect(container.querySelector(".weather-inline")).toBeNull();
  });
});

// SCHED-F-13 (2026-09-05), option A: "Day head open total and Plan My Day
// open total disagree for the same day." The head summed its Open ROWS, which
// count a soft block busy and drop any gap under thirty minutes; the plan
// sheet counts soft blocks open because the planner schedules over them when
// the day is tight. The head answers "can I take this on", so it is the
// planner's number now.
describe("the day head counts open time the way the planner does", () => {
  const day = {
    ...base,
    selected: "2026-05-21",
    todayDate: "2026-05-20",
    mode: "day" as const,
    dayEvents: [{ id: "e1", data: { title: "Board Call", date: "2026-05-21", start: "09:00", end: "10:00", category: "orgB" } }],
    locked: [{ s: 12 * 60, e: 13 * 60, label: "Lunch", soft: true }],
    windowStartMin: 7 * 60,
    windowEndMin: 21 * 60,
  };

  it("a soft block is open time, so the head and the plan sheet say the same hours", async () => {
    const { openMinutes } = await import("./planLoad");
    const { container } = render(<SchedulePage {...day} />);
    expect(container.querySelector(".sc-dayhead .sc-fact")!.textContent).toContain("13h open");
    // The same number the plan sheet builds from, field for field.
    expect(openMinutes(day.dayEvents, day.locked, 7 * 60, 21 * 60)).toBe(13 * 60);
  });

  it("a hard block is still busy on both", async () => {
    const { openMinutes } = await import("./planLoad");
    const hard = { ...day, locked: [{ s: 12 * 60, e: 13 * 60, label: "School Run" }] };
    const { container } = render(<SchedulePage {...hard} />);
    expect(container.querySelector(".sc-dayhead .sc-fact")!.textContent).toContain("12h open");
    expect(openMinutes(hard.dayEvents, hard.locked, 7 * 60, 21 * 60)).toBe(12 * 60);
  });
});
