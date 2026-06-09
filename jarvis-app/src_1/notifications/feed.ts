import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Area, Goal } from "../life/types";

export type NudgeKind = "overdue" | "due_today" | "event" | "goal_risk" | "area_drift";
export interface Nudge { id: string; kind: NudgeKind; title: string; sub: string; when: string; }

export interface FeedInput { tasks: TaskItem[]; events: EventItem[]; goals: Goal[]; areas: Area[]; }

// Builds the notifications feed from the user's own data. No placeholders.
// Ordered by urgency: overdue, due today, today's events, goals at risk, drifting areas.
export function buildFeed(input: FeedInput, today: string): Nudge[] {
  const out: Nudge[] = [];
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due < today) out.push({ id: "ov-" + t.id, kind: "overdue", title: t.data.text, sub: "Overdue", when: "" });
  }
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due === today) out.push({ id: "dt-" + t.id, kind: "due_today", title: t.data.text, sub: "Due today", when: "" });
  }
  input.events.filter((e) => e.data.date === today).sort((a, b) => a.data.start.localeCompare(b.data.start))
    .forEach((e) => out.push({ id: "ev-" + e.id, kind: "event", title: e.data.title, sub: "Today", when: e.data.start }));
  for (const g of input.goals) if (g.data.state === "at_risk") out.push({ id: "gr-" + g.id, kind: "goal_risk", title: g.data.title, sub: "Goal at risk", when: "" });
  for (const a of input.areas) if (a.data.state === "drifting") out.push({ id: "ad-" + a.id, kind: "area_drift", title: a.data.name, sub: "Life area drifting", when: "" });
  return out;
}
