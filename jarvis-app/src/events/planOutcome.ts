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
 * The picks committed for one local day, in the order they were picked, or an
 * empty list if no plan was committed for it.
 *
 * "HOW DID I DO TODAY" WAS NEVER RE-EVALUATED (Dave, on the list since
 * 2026-09-07, unblocked 2026-09-09). resolvePendingPlans below only ever looks
 * at days that have ALREADY PASSED, by design: a pick is scored on whether it
 * was done by the end of its own local day, and that answer does not exist
 * until the day is over. The consequence nobody had closed is that the plan he
 * commits in the morning is invisible for the rest of the day. It is written
 * to storage, it is scored at midnight into an event log, and the only thing
 * that ever reads the score is planCap, which uses it to size the NEXT plan.
 * He is never shown how the day he is standing in is going.
 *
 * This is the reader that lets a live surface ask. It is deliberately not a
 * score: it hands back the picks, and the caller joins them to the tasks as
 * they are RIGHT NOW, so the answer re-derives on every render instead of
 * being computed once and cached into staleness.
 */
export function pendingPicks(day: string, storage: PlanStorage = localPlanStorage): string[] {
  return readPending(storage).find((p) => p.day === day)?.picks ?? [];
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
        // The DAY rides along (2026-08-20). Without it a plan.outcome cannot
        // be traced back to the plan it came from, so nothing downstream can
        // ask "did that shape of day actually work". Older events lack it and
        // every reader treats a missing day as unscoreable rather than zero.
        props: { n: i + 1, flag: doneSameDay, day: plan.day },
      });
      resolved++;
    });
  }
  storage.write(JSON.stringify(pending.filter((p) => !(p.day < todayIso))));
  return resolved;
}

// ---- Reading it back (2026-08-10) ----
// The audit found this measurement was computed, logged, synced, and never
// looked at. This is the reader: the last two weeks of plan.outcome events,
// summarized for the one place the number can change behavior, the moment
// the user commits the next plan.

export const PLAN_RECORD_DAYS = 14;
// Below this many scored picks the number is noise, so nothing renders.
const PLAN_RECORD_MIN_PICKS = 3;

export interface PlanRecord { picks: number; done: number }

export function planRecord(
  events: { type: string; ts: number; props?: Record<string, unknown> }[],
  now: number,
  windowDays = PLAN_RECORD_DAYS,
): PlanRecord {
  const since = now - windowDays * 86400000;
  const rows = events.filter((e) => e.type === "plan.outcome" && e.ts >= since);
  return { picks: rows.length, done: rows.filter((e) => e.props?.flag === true).length };
}

// PLUMB-F-19 (2026-09-05): planRecordLine went, and schedule/planCap.ts's
// header says why. "Lately · 2 of 7 picks done same-day" was pulled from the
// sheet on 2026-08-20 as a scoreboard sitting above the thing it said he was
// failing at; the same measurement pointed forward became capOffer. The
// sentence outlived its screen with only its own test to keep it green, and
// leaving it there is how it comes back. planRecord above still counts, and
// planCap is what reads the count.
