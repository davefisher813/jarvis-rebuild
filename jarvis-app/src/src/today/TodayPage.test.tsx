// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
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


const ev = (id: string, start: string, cat = "tucci"): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: cat } });
const tk = (id: string, due: string | null, cat = "tucci", done = false): TaskItem => ({ id, data: { text: id, category: cat, done, due } });

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 2, due: 1, overdue: 1 },
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
    const summary = container.querySelector(".today-summary")!;
    expect(summary).toHaveTextContent("2 events");
    expect(summary).toHaveTextContent("1 task due");
    expect(summary.querySelector(".fg-red")).toHaveTextContent("1 overdue");
  });

  it("renders Today's Tasks with the right urgency colors", () => {
    const { container } = render(<TodayPage {...base} />);
    expect(screen.getByText("Today\u2019s Tasks")).toBeInTheDocument();
    expect(container.querySelector(".urgency-red")).toBeTruthy(); // overdue
    expect(container.querySelector(".urgency-warn")).toBeTruthy(); // due today
    expect(container.querySelector(".task-check.cat-bd-sky")).toBeTruthy();
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
