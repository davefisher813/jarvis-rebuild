import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Area, Goal } from "../life/types";

export type NudgeKind = "overdue" | "due_today" | "event" | "goal_risk" | "area_drift";
// A1 (audit 2026-08-21): every row on this screen was a dead end. Ten
// sentences telling him things with nothing to do about any of them, which
// is the definition of a notification that trains you to ignore
// notifications. A nudge now carries the thing it is ABOUT, so a tap opens
// it and a task can be finished from here.
export interface Nudge {
  id: string;
  kind: NudgeKind;
  title: string;
  sub: string;
  when: string;
  // The entity behind the words. `entity` is the navigation kind AppShell
  // already speaks ("task" | "event" | "goal"); `entityId` is its real id,
  // not the prefixed feed id.
  entity: "task" | "event" | "goal" | "area";
  entityId: string;
}

export interface FeedInput { tasks: TaskItem[]; events: EventItem[]; goals: Goal[]; areas: Area[]; }

// Builds the notifications feed from the user's own data. No placeholders.
// Ordered by urgency: overdue, due today, today's events, goals at risk, drifting areas.
export function buildFeed(input: FeedInput, today: string): Nudge[] {
  const out: Nudge[] = [];
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due < today) out.push({ id: "ov-" + t.id, kind: "overdue", title: t.data.text, sub: "Overdue", when: "", entity: "task", entityId: t.id });
  }
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due === today) out.push({ id: "dt-" + t.id, kind: "due_today", title: t.data.text, sub: "Due today", when: "", entity: "task", entityId: t.id });
  }
  input.events.filter((e) => e.data.date === today).sort((a, b) => a.data.start.localeCompare(b.data.start))
    .forEach((e) => out.push({ id: "ev-" + e.id, kind: "event", title: e.data.title, sub: "Today", when: e.data.start, entity: "event", entityId: e.id }));
  for (const g of input.goals) if (g.data.state === "at_risk") out.push({ id: "gr-" + g.id, kind: "goal_risk", title: g.data.title, sub: "Goal at risk", when: "", entity: "goal", entityId: g.id });
  for (const a of input.areas) if (a.data.state === "drifting") out.push({ id: "ad-" + a.id, kind: "area_drift", title: a.data.name, sub: "Life area drifting", when: "", entity: "area", entityId: a.id });
  return out;
}
