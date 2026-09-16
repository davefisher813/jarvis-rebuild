// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([{ id: "orgB", name: "Ridgeley", color: "sky" }]);

const ev = (id: string, start: string): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: "orgB" } });
const tk = (id: string, due: string | null): TaskItem => ({ id, data: { text: id, category: "orgB", done: false, due } });

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 1, due: 1, overdue: 0, moves: 0 },
  todayEvents: [ev("e1", "09:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [],
  tomorrowDate: "Thu, May 21",
  tasks: [tk("Call the bank", "2026-05-20")],
  today: "2026-05-20",
  onSeeAllSchedule: () => {},
  onSeeAllTasks: () => {},
};

// THE FIFTEEN IS THE HEADLINER WHILE IT RUNS (Dave 2026-09-16: "I still
// haven't clicked a button and it helped me in any single way on this home
// page"). Start used to write a block and leave the page unchanged.
describe("the running fifteen", () => {
  afterEach(cleanup);

  const running = { taskId: "Call the bank", text: "Call the bank", line: "14:32 Left", over: false };

  it("takes the headliner slot from the dealt card and shows the clock", () => {
    render(
      <TodayPage {...base} upNext={[tk("Something else", "2026-05-20")]} onUpNext={() => {}}
        moveReason="Fits before Deep Work" fifteen={running}
        onFifteenDone={() => {}} onFifteenStop={() => {}} onFifteenAgain={() => {}} />,
    );
    expect(screen.getByText("Call the bank")).toBeInTheDocument();
    expect(screen.getByText("14:32 Left")).toBeInTheDocument();
    // The dealt card's own reason is not showing beside a running block.
    expect(screen.queryByText("Fits before Deep Work")).not.toBeInTheDocument();
  });

  it("offers Done and a way out while it runs, and never Start or Tomorrow", () => {
    const done = vi.fn();
    const stop = vi.fn();
    render(
      <TodayPage {...base} upNext={[tk("Call the bank", "2026-05-20")]} onUpNext={() => {}}
        onStartTask={() => {}} onTomorrowMove={() => {}} fifteen={running}
        onFifteenDone={done} onFifteenStop={stop} onFifteenAgain={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tomorrow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Another 15" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalled();
  });

  // ONE QUESTION AT THE END, AND BOTH ANSWERS ARE REAL.
  it("asks done or another fifteen when the block is up, and drops Stop", () => {
    const again = vi.fn();
    render(
      <TodayPage {...base} upNext={[tk("Call the bank", "2026-05-20")]} onUpNext={() => {}}
        fifteen={{ ...running, over: true, line: "15 Minutes up" }}
        onFifteenDone={() => {}} onFifteenStop={() => {}} onFifteenAgain={again} />,
    );
    expect(screen.getByText("15 Minutes up")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Another 15" }));
    expect(again).toHaveBeenCalled();
  });

  // A block started at 5:50 does not stop mattering at six: the evening has
  // no dealt card, and the running block holds the slot anyway.
  it("holds the headliner in the evening, where there is no dealt card", () => {
    render(
      <TodayPage {...base} evening={{ doneDue: 1, dueTotal: 1, eventsLeft: 0, openCount: 0, thingsDone: 1 }} fifteen={running}
        onFifteenDone={() => {}} onFifteenStop={() => {}} onFifteenAgain={() => {}} />,
    );
    expect(screen.getByText("14:32 Left")).toBeInTheDocument();
  });

  it("is absent entirely when nothing is running", () => {
    render(<TodayPage {...base} upNext={[tk("Call the bank", "2026-05-20")]} onUpNext={() => {}} onStartTask={() => {}} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });
});
