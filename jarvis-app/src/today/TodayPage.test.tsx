// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { setCategoryRegistry } from "../shared/categories";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const ev = (id: string, start: string, cat = "orgB"): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: cat } });
const tk = (id: string, due: string | null, cat = "orgB", done = false): TaskItem => ({ id, data: { text: id, category: cat, done, due } });

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 2, due: 1, overdue: 1, moves: 0 },
  todayEvents: [ev("e1", "09:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [ev("t1", "09:00")],
  tomorrowDate: "Thu, May 21",
  tasks: [tk("over", "2026-05-18"), tk("due", "2026-05-20")],
  today: "2026-05-20",
  onSeeAllSchedule: () => {},
  onSeeAllTasks: () => {},
};

describe("TodayPage", () => {
  it("renders greeting, date, and the summary with overdue in red", () => {
    const { container } = render(<TodayPage {...base} />);
    expect(screen.getByText("Good Morning")).toBeInTheDocument();
    expect(screen.getByText("Wednesday, May 20")).toBeInTheDocument();
    // SPEC MOVED (Catalog V3.1, 2026-08-18): the workload line is tappable
    // colored pills, not floating text; overdue rides the red pill.
    const summary = container.querySelector(".today-summary")!;
    expect(summary).toHaveTextContent("2 events");
    expect(summary).toHaveTextContent("1 due");
    expect(summary.querySelector(".day-pill.dp-red")).toHaveTextContent("1 overdue");
  });

  it("renders Up Next as ONE dealt card with its reason and the deck receipt", () => {
    // Option 1 (Dave 2026-08-26, "go with what you think is best"): one
    // target on screen. The card keeps the standard row anatomy (check +
    // title + urgency) plus the reason line every automatic pick owes;
    // everything behind it is a count on a receipt that opens the deck.
    const { container } = render(
      <TodayPage {...base} upNext={[tk("over", "2026-05-18")]} upNextWaiting={2}
        upNextReason="Waiting 2 days" onUpNext={() => {}} onSeeAllUpNext={() => {}} />,
    );
    expect(screen.getByText("Up Next")).toBeInTheDocument();
    expect(screen.getByText("See All")).toBeInTheDocument();
    expect(container.querySelector(".urgency-red")).toBeTruthy(); // overdue
    expect(container.querySelector(".task-check.cat-bd-sky")).toBeTruthy();
    expect(screen.getByText("Waiting 2 days")).toBeInTheDocument();
    expect(screen.getByText("2 More waiting \u00b7 Skip deals the next one")).toBeInTheDocument();
    // one card means one row, however deep the deck is
    expect(container.querySelectorAll(".task-row").length).toBe(1);
    // the old daytime task list is replaced by Up Next
    expect(screen.queryByText("Today\u2019s Tasks")).toBeNull();
  });

  it("shows today's birthdays above Up Next, and nothing on ordinary days", () => {
    const { container, rerender } = render(
      <TodayPage {...base} birthdays={[{ id: "p1", name: "Mike Torres" }]} upNext={[tk("due", "2026-05-20")]} onUpNext={() => {}} />,
    );
    expect(screen.getByText("Birthday")).toBeInTheDocument();
    expect(screen.getByText("Mike Torres")).toBeInTheDocument();
    expect(screen.getByText("Turns a year older today")).toBeInTheDocument();
    // SPEC MOVED (Library phase 2, 2026-08-18): section heads are the bold
    // sh2 form; the birthday avatar keeps people-pink (never red).
    expect(container.querySelector(".av.cat-bg-pink")).toBeTruthy();
    // section order: Birthday section head precedes Up Next's
    const heads = [...container.querySelectorAll(".sh2 .t")].map((e) => e.textContent);
    expect(heads.indexOf("Birthday")).toBeLessThan(heads.indexOf("Up Next"));
    // absent = the normal state, and the plural title only with 2+
    rerender(<TodayPage {...base} birthdays={[]} />);
    expect(screen.queryByText("Birthday")).toBeNull();
    rerender(<TodayPage {...base} birthdays={[{ id: "a", name: "A" }, { id: "b", name: "B" }]} />);
    expect(screen.getByText("Birthdays")).toBeInTheDocument();
  });

  it("shows the Focus button paired with Plan My Day (daytime only)", () => {
    render(<TodayPage {...base} upNext={[tk("due", "2026-05-20")]} onUpNext={() => {}} onPlanDay={() => {}} />);
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("Plan My Day")).toBeInTheDocument();
  });

  it("evening keeps the Still Open recap instead of Up Next, no Focus", () => {
    render(
      <TodayPage
        {...base}
        evening={{ doneDue: 2, dueTotal: 3, eventsLeft: 0, openCount: 1, thingsDone: 2 }}
        upNext={[tk("due", "2026-05-20")]}
        onUpNext={() => {}}
        onPlanDay={() => {}}
      />,
    );
    expect(screen.queryByText("Up Next")).toBeNull();
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.getByText("Still Open")).toBeInTheDocument();
  });

  it("evening folds a long Still Open list to five rows and a receipt", () => {
    // Dave's screenshot (2026-08-26): fifteen bare rows at 10:35 PM. The
    // recap shows the top five; the rest is a count that opens Tasks.
    const many = Array.from({ length: 8 }, (_, i) => tk("t" + i, "2026-05-20"));
    const { container } = render(
      <TodayPage {...base}
        evening={{ doneDue: 2, dueTotal: 3, eventsLeft: 0, openCount: 8, thingsDone: 2 }}
        tasks={many} onUpNext={() => {}} />,
    );
    expect(container.querySelectorAll(".task-row").length).toBe(5);
    expect(screen.getByText("3 More still open")).toBeInTheDocument();
  });

  it("renders Your Day and Tomorrow sections", () => {
    render(<TodayPage {...base} />);
    expect(screen.getByText("Your Day")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("hides Today's Tasks and Tomorrow when there is no data", () => {
    render(<TodayPage {...base} tasks={[]} tomorrowEvents={[]} />);
    expect(screen.queryByText("Today\u2019s Tasks")).toBeNull();
    expect(screen.queryByText("Tomorrow")).toBeNull();
  });
});
