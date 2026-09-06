// PLAN IT LIKE A DAY THAT WORKED (P12, Dave 2026-08-20) -- RETIRED.
//
// SCHED-F-17 (2026-09-05): the P12 offer came out of PlanDaySheet in commit
// 47173c2 (2026-08-22) and this module was left behind whole. ScheduleService
// kept calling saveShape on every commit, filling a localStorage key that
// nothing has read since, and loadShapes / dayScores / shapeOffer /
// applyShape / ShapeOffer / DayShape / ShapeSlot sat here green on their own
// tests. The write stopped and the shape half went; bringing P12 back is a
// feature decision, not a cleanup, and the git history above is where it
// comes back from.
//
// What survives is planCount, which PlanDaySheet reads: how many days the
// outcome log has scores for, which is the evidence gate the cap offer
// (planCap.ts) needs before it will say a number.

// Per-day scores from the outcome log. A day whose events carry no `day` prop
// (recorded before 2026-08-20) is simply absent: unscoreable, never zero.
export function dayScores(
  events: { type: string; props?: Record<string, unknown> }[],
): Record<string, { picks: number; done: number }> {
  const out: Record<string, { picks: number; done: number }> = {};
  for (const e of events) {
    if (e.type !== "plan.outcome") continue;
    const day = e.props?.day;
    if (typeof day !== "string") continue;
    const row = out[day] ?? { picks: 0, done: 0 };
    row.picks++;
    if (e.props?.flag === true) row.done++;
    out[day] = row;
  }
  return out;
}

// How many distinct plans the record covers, so a finish rate can be per-day
// rather than per-pick.
export function planCount(events: { type: string; props?: Record<string, unknown> }[]): number {
  return Object.keys(dayScores(events)).length;
}
