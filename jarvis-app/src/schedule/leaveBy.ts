// LEAVE BY (UP-CORE-07, 2026-09-05, option C: A now, B behind the same chip).
//
// The one number a time-blind person cannot compute is not when the thing
// starts, it is when to stand up. The app knew where events were (EventData
// .location, and DayRow has linked it to Apple Maps since it was written) and
// never once said what that meant for the clock.
//
// WHAT THIS IS NOT. It is not a route, a GPS read, or a learned place. The
// minutes are the ones the person typed, once, for a place they named, and
// they are remembered against the exact string they typed it for (profile
// .travel, which syncs). No location permission is asked for and no place is
// ever inferred, which is the Brain hold-back on Places kept literally:
// nothing here knows where anybody is.
//
// Option B, live ETA from the Apple Maps Server API, plugs in at exactly one
// seam: travelFor() below answers "how long to this place", and a server
// route can answer it better once Apple Developer enrollment clears. Every
// consumer reads the answer, not the source, so nothing else changes.
//
// weather.ts's own rule stands: weather never adjusts these minutes. A
// forecast is not a traffic report and pretending otherwise is a lie with a
// number on it.

import { addMinutes } from "./calendar";

// The chips. Whole numbers of minutes, the same shape every other length
// control in the app offers, plus a typed value for anything else.
export const TRAVEL_CHOICES = [10, 20, 30, 45] as const;
// Slack on top of the travel, for the coat, the keys and the door.
export const BUFFER_CHOICES = [5, 10, 15] as const;

export interface LeaveInput {
  start: string;
  travelMin?: number;
  bufferMin?: number;
}

// A travel time is minutes, whole, positive, and inside a day. Anything else
// is a corrupt row and is treated as absent rather than clamped into a number
// nobody chose.
export const MAX_TRAVEL_MIN = 8 * 60;
export function isTravel(min: number | null | undefined): min is number {
  return typeof min === "number" && Number.isFinite(min) && Number.isInteger(min) && min > 0 && min <= MAX_TRAVEL_MIN;
}

// The total lead: travel plus whatever slack was asked for. Null when no
// travel time has been given, which is the normal state and says nothing.
export function leadFor(e: LeaveInput): number | null {
  if (!isTravel(e.travelMin)) return null;
  const buffer = isTravel(e.bufferMin) ? e.bufferMin : 0;
  return e.travelMin + buffer;
}

// "HH:MM" to leave by, or null. Clamped at the start of the day rather than
// wrapping into the previous one: a leave time of 23:40 for a 00:10 event
// would sort to the END of the day and read as after the event.
export function leaveByOf(e: LeaveInput): string | null {
  const lead = leadFor(e);
  if (lead === null || !/^\d{2}:\d{2}$/.test(e.start)) return null;
  // calendar.ts owns every HH:MM operation in the app, including this clamp.
  return addMinutes(e.start, -lead);
}

// ---- The memory ----------------------------------------------------------
//
// Keyed on the exact place string the person typed, normalised only for case
// and outside whitespace: "Rink 2" and "rink 2 " are the same place, and
// nothing cleverer is attempted. Two spellings of one address stay two
// places, which is honest, and each is one chip away from being right.

export type TravelMemory = Record<string, number>;

export function travelKey(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

export function travelFor(memory: TravelMemory | undefined, location: string | undefined): number | undefined {
  if (!memory || !location?.trim()) return undefined;
  const min = memory[travelKey(location)];
  return isTravel(min) ? min : undefined;
}

// Returns the next memory, or null when nothing would change (so a caller
// never writes to the profile for no reason). A null `minutes` forgets the
// place entirely, which is the Forget row.
export function rememberTravel(
  memory: TravelMemory | undefined,
  location: string | undefined,
  minutes: number | null,
): TravelMemory | null {
  if (!location?.trim()) return null;
  const key = travelKey(location);
  const cur = memory ?? {};
  if (minutes === null) {
    if (!(key in cur)) return null;
    const next = { ...cur };
    delete next[key];
    return next;
  }
  if (!isTravel(minutes) || cur[key] === minutes) return null;
  return { ...cur, [key]: minutes };
}
