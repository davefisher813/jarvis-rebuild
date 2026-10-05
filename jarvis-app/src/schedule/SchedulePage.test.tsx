// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SchedulePage from "./screens/SchedulePage";
import { numberCaseViolations } from "../laws/catalogCheck";
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

    it("every day, in this month or spilling in from another, is a tab stop", () => {
      const { container } = render(<SchedulePage {...base} />);
      const outside = [...container.querySelectorAll(".cal-cell.out")];
      expect(outside.length, "May 2026 spills into April and June").toBeGreaterThan(0);
      expect([...container.querySelectorAll(".cal-cell")].every((c) => c.getAttribute("tabindex") === "0")).toBe(true);
    });

    for (const k of ["Enter", " "]) {
      it(`picks a day on ${k === " " ? "Space" : k}`, () => {
        const onSelect = vi.fn();
        const { container } = render(<SchedulePage {...base} onSelect={onSelect} />);
        fireEvent.keyDown(container.querySelectorAll(".cal-cell:not(.out)")[3]!, { key: k });
        expect(onSelect).toHaveBeenCalledTimes(1);
      });
    }

    // Dave, 2026-10-04: no dead buttons. A day spilling in from the last or
    // the next month used to be inert; it is a day like any other now.
    it("a day outside the month picks that day, by key and by tap", () => {
      const onSelect = vi.fn();
      const { container } = render(<SchedulePage {...base} onSelect={onSelect} />);
      const out = container.querySelector(".cal-cell.out")!;
      const date = out.getAttribute("aria-label")!;
      expect(date).not.toMatch(/^2026-05/);
      fireEvent.keyDown(out, { key: "Enter" });
      fireEvent.click(out);
      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(onSelect).toHaveBeenNthCalledWith(1, date);
      expect(onSelect).toHaveBeenNthCalledWith(2, date);
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
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(container.querySelector(".sc-dayhead .sc-fact")!.textContent).toContain("13h Open");
    // The same number the plan sheet builds from, field for field.
    expect(openMinutes(day.dayEvents, day.locked, 7 * 60, 21 * 60)).toBe(13 * 60);
  });

  it("a hard block is still busy on both", async () => {
    const { openMinutes } = await import("./planLoad");
    const hard = { ...day, locked: [{ s: 12 * 60, e: 13 * 60, label: "School Run" }] };
    const { container } = render(<SchedulePage {...hard} />);
    expect(container.querySelector(".sc-dayhead .sc-fact")!.textContent).toContain("12h Open");
    expect(openMinutes(hard.dayEvents, hard.locked, 7 * 60, 21 * 60)).toBe(12 * 60);
  });
});

// THE NUMBER RULE (Dave 2026-10-05, caught live as "Earlier 2 blocks"): the word behind a leading number is
// capitalized, in the singular and the plural. The fold is a count built in JSX, which a source scan cannot see.
describe("SchedulePage: the Earlier fold follows the number rule", () => {
  const day = { ...base, mode: "day" as const, now: "12:00" };
  const foldText = (events: EventItem[]) => {
    const { container } = render(<SchedulePage {...day} dayEvents={events} />);
    return { container, text: container.querySelector(".sched-earlier .n")!.textContent };
  };

  it("two passed blocks read '2 Blocks'", () => {
    const { container, text } = foldText([ev("a", "08:00"), ev("b", "09:00")]);
    expect(text).toBe("2 Blocks");
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("one passed block reads '1 Block'", () => {
    const { container, text } = foldText([ev("a", "08:00")]);
    expect(text).toBe("1 Block");
    expect(numberCaseViolations(container)).toEqual([]);
  });
});

// THE CATALOG, CHECKED ON WHAT THE PAGE DRAWS (Dave 2026-10-05: "I am sick of
// this"). Counts and lengths built in JSX are invisible to a source scan, so each
// is read off the DOM: the word behind a number is capitalized, a minutes-only
// length is "45 Min" never "45m", and the week axis says Noon.
describe("SchedulePage: the week, the repeats and a nested pick follow the catalog (2026-10-05)", () => {
  const weekRow = (date: string, day: number, dow: number, count: number, openMin: number) => ({
    date, day, dow, windowS: 7 * 60, windowE: 21 * 60, blocks: [], count, openMin, longest: openMin > 0 ? { s: 9 * 60, e: 9 * 60 + openMin } : null,
  });
  const weekCells = [18, 19, 20, 21].map((d) => ({ date: `2026-05-${d}`, day: d, dow: d - 18, dots: [], isToday: d === 20 }));

  it("week rows say '2 Blocks' behind a past day, '3h Open' ahead, and the axis says Noon", () => {
    const rows = [weekRow("2026-05-18", 18, 0, 2, 0), weekRow("2026-05-19", 19, 1, 1, 0), weekRow("2026-05-20", 20, 2, 0, 180), weekRow("2026-05-21", 21, 3, 0, 90)];
    const { container } = render(<SchedulePage {...base} mode="week" weekCells={weekCells as never} weekRows={rows} />);
    const opens = Array.from(container.querySelectorAll(".wk-open")).map((e) => e.textContent);
    expect(opens).toEqual(["2 Blocks", "1 Block", "3h Open", "1h 30m Open"]);
    expect(container.querySelector(".wk-head .n")!.textContent).toBe("4h 30m Open");
    expect(container.querySelector(".wk-note")!.textContent).toMatch(/^Longest Open Stretch/);
    expect(container.querySelector(".wk-ticks")!.textContent).toContain("Noon");
    expect(container.querySelector(".wk-ticks")!.textContent).not.toContain("noon");
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("a repeat's skip count reads '2 Skipped' as the row's white number, beside a small-caps end date and one grey cadence", () => {
    const repeats = [{ id: "r1", title: "Practice", category: "orgB", start: "17:00", recurrence: "weekly" as const, cadence: "Every Tuesday", ends: "Through Nov 8", endless: false, skipped: 2 }];
    const { container } = render(<SchedulePage {...base} mode="repeats" repeats={repeats} />);
    const facts = container.querySelector(".facts")!;
    expect(facts.querySelector(".fact > b")!.textContent).toBe("2 Skipped");
    expect(facts.querySelector(".fact.date")!.textContent).toBe("Through Nov 8");
    expect(numberCaseViolations(container)).toEqual([]);
  });

  it("a pick nested in a block shows its length as the spelled span, '45 Min', never '45m'", () => {
    const holder = { s: 9 * 60, e: 12 * 60, label: "Deep Work", id: "dw", kind: "focus", mode: "holds" };
    const blocks = [
      { taskId: "t1", text: "Write Report", category: "orgB", start: "09:00", end: "09:45" },
      { taskId: "t2", text: "Review Plan", category: "orgB", start: "10:00", end: "11:30" },
    ];
    const proposed = { blocks, openId: null, onToggle: () => {}, onDuration: () => {}, onDrop: () => {} };
    const { container } = render(<SchedulePage {...base} mode="day" locked={[holder] as never} proposed={proposed as never} />);
    const lengths = Array.from(container.querySelectorAll(".block-held-facts .fact > b")).map((b) => b.textContent);
    expect(lengths).toEqual(["45 Min", "1h 30m"]);
    expect(numberCaseViolations(container)).toEqual([]);
  });
});

// THE DAY VIEW'S SCROLL IS UNCHANGED (Dave 2026-10-05: "the schedule's scroll behavior was good, do not let the catalog fixes break
// it"). The row-action pass wrapped Anytime rows in a swipe tray, took the grip off the event rows and moved Copy Yesterday into
// the head, all inside the page's scroll. This holds the three things that behaviour is: the page itself scrolls (no row, card
// or list became a scroll container of its own), the Now row is still scrolled into view on open, and the Earlier fold still
// opens and shuts.
describe("SchedulePage: the day view still scrolls the way it did", () => {
  const events = [ev("a", "07:00"), ev("b", "08:00"), ev("c", "09:00"), ev("d", "10:00"), ev("e", "13:00"), ev("f", "14:00")];
  const day = { ...base, mode: "day" as const, now: "11:30", dayEvents: events };
  const tasks = [{ id: "t1", data: { text: "get new car insurance" } }, { id: "t2", data: { text: "get ein number" } }] as never;

  // jsdom has no layout and no scrollIntoView; the stub is the thing the page calls.
  let spy: ReturnType<typeof vi.fn>;
  beforeEach(() => { spy = vi.fn(); Element.prototype.scrollIntoView = spy as never; });

  it("scrolls the next row to the centre on open, once the day is long enough to need it", () => {
    render(<SchedulePage {...day} anytimeItems={tasks} onScheduleTask={() => {}} onToggleTask={() => {}} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ block: "center" });
    // The row it centres is the next event (1:00 PM, "e"), not the head and not an Anytime row.
    expect((spy.mock.contexts[0] as HTMLElement).textContent).toContain("1:00");
    expect((spy.mock.contexts[0] as HTMLElement).closest(".anytime-card")).toBeNull();
  });

  it("does not scroll a short day, or a day that is not today", () => {
    render(<SchedulePage {...day} dayEvents={[ev("a", "13:00")]} />);
    render(<SchedulePage {...day} selected="2026-05-21" />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("the Earlier fold opens to the morning's rows and shuts again", () => {
    const { container } = render(<SchedulePage {...day} />);
    const fold = container.querySelector(".sched-earlier") as HTMLElement;
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    const before = container.querySelectorAll(".sched-swipe-wrap").length;
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".sched-swipe-wrap").length).toBeGreaterThan(before);
    fireEvent.click(fold);
    expect(container.querySelectorAll(".sched-swipe-wrap").length).toBe(before);
  });

  it("no row, card or list on the day became a scroll container of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const css = ["components.css", "ruled.css"].map((f) => readFileSync(new URL("../styles/" + f, import.meta.url), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const sel of [".sched-list", ".sched-card", ".sched-swipe-wrap", ".anytime-card", ".task-swipe", ".sched-row"]) {
      const rules = css.match(new RegExp("(?:^|\\n)[^{}]*" + sel.replace(".", "\\.") + "(?![\\w-])[^{}]*\\{[^}]*\\}", "g")) ?? [];
      for (const r of rules) {
        expect(r, sel + " must not scroll on its own: " + r.trim().slice(0, 90)).not.toMatch(/overflow-y:\s*(auto|scroll)|max-height:\s*(?!none)/);
      }
    }
    const { container } = render(<SchedulePage {...day} />);
    expect(container.querySelector(".screen")!.getAttribute("style")).toBeNull();
  });
});
