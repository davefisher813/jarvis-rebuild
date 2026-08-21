import type { EventItem } from "./types";

// ONE PLANNER EVENT PER TASK PER DAY (hotfix 2026-08-21, Dave's "adhd
// nightmare" screenshots: five tasks placed twice, nine Overlaps badges).
//
// The import law (HOTFIX_GCAL_DUPES) already said it for Google events: any
// import or placement pass must sweep duplicates by source id BEFORE writing,
// and never trust a possibly-cold read as proof of absence. The planner broke
// the same law wearing different clothes: Plan My Day, the Today day-draft
// card, and tap-to-schedule each wrote fresh events for a task without ever
// sweeping their own prior output, so a re-plan ADDED instead of REPLACED.
//
// Two layers, mirroring the gcal fix:
//   - Write boundary: a plan commit deletes the plan events it supersedes
//     (same sourceTaskId, same day) in the same pass that writes new ones.
//   - Read boundary: a self-healing sweep collapses any (task, day) group
//     that still holds more than one plan event, so the existing mess heals
//     itself with no manual deleting.
//
// Cold-read safety: both layers act only on duplicates VISIBLE in one
// consistent read. A cold read that misses a copy simply shows no duplicate
// and deletes nothing; it can never delete based on absence.

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

// A planner-created event: carries the task it was placed from. Google
// imports and recurring series are never the planner's output and are never
// touched by any sweep here.
export function isPlanEvent(e: EventItem): boolean {
  return !!e.data.sourceTaskId && !e.data.gcalId && (!e.data.recurrence || e.data.recurrence === "none");
}

// Ids to DELETE so each task keeps exactly one plan event on `date`.
// Keep rule: first-upcoming wins. When `nowMin` is set (viewing today), the
// earliest copy starting at or after now is the one the user can still act
// on, so it survives; with no upcoming copy, or on another day, the earliest
// copy survives. Events must already be the single day's list.
export function planDuplicateIds(events: EventItem[], nowMin: number | null = null): string[] {
  const byTask = new Map<string, EventItem[]>();
  for (const e of events) {
    if (!isPlanEvent(e)) continue;
    const key = e.data.sourceTaskId!;
    const list = byTask.get(key);
    if (list) list.push(e); else byTask.set(key, [e]);
  }
  const out: string[] = [];
  for (const list of byTask.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => toMin(a.data.start) - toMin(b.data.start) || a.id.localeCompare(b.id));
    const upcoming = nowMin === null ? undefined : sorted.find((e) => toMin(e.data.start) >= nowMin);
    const keep = upcoming ?? sorted[0]!;
    for (const e of sorted) if (e.id !== keep.id) out.push(e.id);
  }
  return out;
}

// Ids of the plan events a new commit for `taskIds` supersedes: the same
// task's prior placement on the same day. Deleted before the new events are
// written, so a plan commit REPLACES, never adds.
export function supersededPlanEventIds(events: EventItem[], taskIds: string[]): string[] {
  const tasks = new Set(taskIds);
  return events.filter((e) => isPlanEvent(e) && tasks.has(e.data.sourceTaskId!)).map((e) => e.id);
}
