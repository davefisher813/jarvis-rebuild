import type { EventInput } from "./types";
import { localDayParts } from "./serverSink";

// Plan-vs-done, the single most valuable measurement this app takes (design
// doc, layer 1). Plan My Day commits picks; nothing ever checked whether they
// happened. This module closes the loop.
//
// THE LOCKED DEFINITION (accuracy-critical, stated wherever the stat renders):
// a pick counts as done ONLY if it was completed by end of that LOCAL day.
// Completed two days later after a push = not done for that plan. A deleted
// task = not done. Same-day evidence comes from Time Sense samples, which
// carry the task id and completion timestamp.
//
// Replanning the same day replaces that day's picks: the last plan of the day
// is the plan that gets scored.

const KEY = "jarvis.plan.pending.v1";

interface PendingPlan {
  day: string; // local YYYY-MM-DD the plan was made for
  picks: string[]; // ordered task ids (position = n)
}

export interface PlanStorage {
  read(): string | null;
  write(value: string): void;
}

export const localPlanStorage: PlanStorage = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* best-effort */
    }
  },
};

function readPending(storage: PlanStorage): PendingPlan[] {
  const raw = storage.read();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingPlan[]) : [];
  } catch {
    return [];
  }
}

/** Called when Plan My Day commits a picked plan. Same-day replan replaces. */
export function recordPicks(day: string, picks: string[], storage: PlanStorage = localPlanStorage): void {
  if (picks.length === 0) return;
  const pending = readPending(storage).filter((p) => p.day !== day);
  pending.push({ day, picks });
  storage.write(JSON.stringify(pending));
}

/**
 * Resolve every pending plan whose day has passed. Emits one plan.outcome per
 * pick (n = position, flag = done that same local day) and clears resolved
 * plans. Today's own plan stays pending until tomorrow.
 */
export function resolvePendingPlans(
  todayIso: string,
  samples: { t: number; id?: string }[],
  emitFn: (e: EventInput) => void,
  storage: PlanStorage = localPlanStorage,
): number {
  const pending = readPending(storage);
  if (pending.length === 0) return 0;
  const due = pending.filter((p) => p.day < todayIso);
  if (due.length === 0) return 0;
  let resolved = 0;
  for (const plan of due) {
    plan.picks.forEach((taskId, i) => {
      const doneSameDay = samples.some(
        (s) => s.id === taskId && localDayParts(s.t).day === plan.day,
      );
      emitFn({
        type: "plan.outcome",
        entityType: "task",
        entityId: taskId,
        props: { n: i + 1, flag: doneSameDay },
      });
      resolved++;
    });
  }
  storage.write(JSON.stringify(pending.filter((p) => !(p.day < todayIso))));
  return resolved;
}
