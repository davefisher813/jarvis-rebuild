// The single per-user routine record: JARVIS's model of the user's daily
// rhythm. Stored as a JSONB Store item (no Supabase migration). Read by both
// the deterministic planner (active hours = planning window) and the AI (work
// hours = sequencing context). The shape is built to extend: the Student
// template will add class and practice blocks on the same entity later, but
// only the Personal fields below are implemented now.
export const ENTITY_ROUTINE = "routine";

// A daily range the planner must never schedule over: gym, meals, family,
// deep work. Days use JS getDay (0=Sun ... 6=Sat) so a block can apply on any
// subset of the week. Times are minutes from midnight. Phase 2.
export interface ProtectedBlock {
  id: string;
  label: string;
  startMin: number;
  endMin: number;
  days: number[];
}

export interface RoutineData {
  wakeMin: number;      // start of the day, minutes from midnight
  sleepMin: number;     // bedtime, minutes from midnight
  workStartMin: number; // start of work hours (AI context only in Phase 1)
  workEndMin: number;   // end of work hours (AI context only in Phase 1)
  // Optional weekend overrides. When weekendDifferent is on, the planner uses
  // weekendWake/weekendSleep on Sat/Sun and skips work hours. Absent or off,
  // weekends use the weekday hours above (no behavior change for anyone who
  // does not opt in). Work hours intentionally have no weekend variant.
  weekendDifferent?: boolean;
  weekendWakeMin?: number;
  weekendSleepMin?: number;
  // Protected time the planner routes around. Absent means none: no behavior
  // change for anyone who has not set any. Phase 2.
  protectedBlocks?: ProtectedBlock[];
}

export const DEFAULT_ROUTINE: RoutineData = {
  wakeMin: 7 * 60,    // 7:00 AM
  sleepMin: 22 * 60,  // 10:00 PM
  workStartMin: 9 * 60,  // 9:00 AM
  workEndMin: 17 * 60,   // 5:00 PM
  weekendDifferent: false,
  weekendWakeMin: 8 * 60,   // 8:00 AM default once enabled
  weekendSleepMin: 23 * 60, // 11:00 PM default once enabled
  protectedBlocks: [],
};

// A protected range resolved for one day: the busy window the planner blocks
// out, carrying its label for the preview. Phase 2.
export interface ProtectedRange { s: number; e: number; label: string }

// The protected ranges that apply on a given day of week, as sorted busy
// ranges for the planner. Malformed blocks (end at or before start, empty
// label, no days) are dropped so a bad entry can never wipe out a day.
// dow: 0=Sun ... 6=Sat (JS getDay).
export function protectedRangesFor(r: RoutineData, dow: number): ProtectedRange[] {
  return (r.protectedBlocks ?? [])
    .filter((b) => b.endMin > b.startMin && b.label.trim() !== "" && b.days.includes(dow))
    .map((b) => ({ s: b.startMin, e: b.endMin, label: b.label.trim() }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
}

// The wake/sleep pair that applies on a given date, honoring weekend overrides.
// dow: 0=Sun ... 6=Sat (JS getDay). Falls back to weekday hours when weekend
// mode is off or the override values are missing.
export function activeHoursFor(r: RoutineData, dow: number): { wakeMin: number; sleepMin: number } {
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend && r.weekendDifferent) {
    return {
      wakeMin: r.weekendWakeMin ?? r.wakeMin,
      sleepMin: r.weekendSleepMin ?? r.sleepMin,
    };
  }
  return { wakeMin: r.wakeMin, sleepMin: r.sleepMin };
}

// Soft, non-blocking UI hints derived from a routine. These never block a save;
// they only let the editor confirm it understood an unusual setup.
export function isOvernight(r: RoutineData): boolean {
  return r.sleepMin <= r.wakeMin;
}
export function isWorkOutsideActive(r: RoutineData): boolean {
  return r.workStartMin < r.wakeMin || r.workEndMin > r.sleepMin;
}

// Convert a "HH:MM" brief time into a wake time in minutes. Used to seed a
// smarter routine from the morning-brief choice during onboarding.
export function wakeFromBrief(briefTime: string): number {
  const p = briefTime.split(":");
  return Number(p[0] ?? 7) * 60 + Number(p[1] ?? 0);
}

// Minutes to stop scheduling before bedtime, so nothing lands right at sleep.
export const WIND_DOWN_MIN = 30;

// The planner's end-of-day cutoff derived from the routine: a wind-down buffer
// before bedtime, floored so it can never cross before the wake time.
export function planEndMin(r: RoutineData): number {
  return Math.max(r.wakeMin + 60, r.sleepMin - WIND_DOWN_MIN);
}

// Day-aware planning window: the wake floor and the wind-down end for a given
// day of week, honoring weekend overrides. This is what the flows use so a
// Saturday plan respects weekend hours when enabled.
export function planWindowFor(r: RoutineData, dow: number): { wakeMin: number; endMin: number } {
  const { wakeMin, sleepMin } = activeHoursFor(r, dow);
  return { wakeMin, endMin: Math.max(wakeMin + 60, sleepMin - WIND_DOWN_MIN) };
}
