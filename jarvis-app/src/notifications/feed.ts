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
//
// LAW 1 (Dave 2026-08-29: "notifications show up on things that are already
// done"). `nowHHMM` is what stops this screen listing a 9 AM standup as a
// live notification at 10 PM. The feed only ever filtered on the DATE, so
// every event you had already sat through stayed on the list until midnight,
// indistinguishable from the ones still ahead of you -- which is precisely
// how a notification screen teaches you to stop reading it. An event that
// has ended is history and belongs on the schedule, not here. Omit nowHHMM
// and the old all-day behaviour stands, for callers with no clock.
export function buildFeed(input: FeedInput, today: string, nowHHMM?: string, dismissed: readonly string[] = []): Nudge[] {
  const out: Nudge[] = [];
  const gone = new Set(dismissed);
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due < today) out.push({ id: "ov-" + t.id, kind: "overdue", title: t.data.text, sub: "Overdue", when: "", entity: "task", entityId: t.id });
  }
  for (const t of input.tasks) {
    if (t.data.done || !t.data.due) continue;
    if (t.data.due === today) out.push({ id: "dt-" + t.id, kind: "due_today", title: t.data.text, sub: "Due today", when: "", entity: "task", entityId: t.id });
  }
  input.events
    .filter((e) => e.data.date === today)
    // Still ahead of him, or still running. An event with no end time counts
    // as over once it has started: a point in time cannot still be upcoming.
    .filter((e) => !nowHHMM || (e.data.end ?? e.data.start) > nowHHMM)
    .sort((a, b) => a.data.start.localeCompare(b.data.start))
    .forEach((e) => out.push({ id: "ev-" + e.id, kind: "event", title: e.data.title, sub: "Today", when: e.data.start, entity: "event", entityId: e.id }));
  for (const g of input.goals) if (g.data.state === "at_risk") out.push({ id: "gr-" + g.id, kind: "goal_risk", title: g.data.title, sub: "Goal at risk", when: "", entity: "goal", entityId: g.id });
  for (const a of input.areas) if (a.data.state === "drifting") out.push({ id: "ad-" + a.id, kind: "area_drift", title: a.data.name, sub: "Life area drifting", when: "", entity: "area", entityId: a.id });
  return out.filter((n) => !gone.has(n.id));
}

// LAW 2: this screen had no dismissal of any kind -- no read state, no
// expiry, nothing. The same overdue rows greeted him on every single visit,
// forever, and the only way to clear one was to finish the task. Dismissals
// are day-keyed like every other one in the app: waving something off buys
// quiet until tomorrow, when it is a fresh fact and gets to ask again.
const DKEY = "jarvis.notifications.dismissed.v1";

export function loadNudgeDismissed(today: string, storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const p = JSON.parse(storage.getItem(DKEY) || "null") as { day?: string; ids?: string[] } | null;
    if (!p || p.day !== today || !Array.isArray(p.ids)) return [];
    return p.ids.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

export function dismissNudge(id: string, today: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  const ids = [...new Set([...loadNudgeDismissed(today, storage), id])];
  try { storage.setItem(DKEY, JSON.stringify({ day: today, ids })); } catch { /* private mode */ }
  return ids;
}
