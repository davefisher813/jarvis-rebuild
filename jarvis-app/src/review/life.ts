import type { Area, Goal } from "../life/types";
import type { GoalReach } from "../bigger/reach";
import { reachedIds } from "../bigger/measure";
import { daysBetween } from "../upnext/upnext";
import { capAfterNumber } from "../shared/casing";

// THE LIFE LAYER'S MODEL (Life View picks 12, 14, 15, 17; 2026-08-25).
// Pure functions, every gate erring toward silence, and the balance stance
// from the catalog carried into code: balance is every chosen part of a
// life staying alive, never a split and never a score (Marks & MacDermid).
// A resting area is a chosen state, not a lapse; a comeback is a win.

export const FED_DAYS = 14; // evidence inside this window = the area is fed
export const STARVED_DAYS = 21; // a chosen area quiet this long earns ONE card
export const REST_DAYS = 90; // It's Resting sleeps an area for a season
export const COMEBACK_GAP = 5; // quiet days that make a return worth naming
export const COMEBACK_RUN = 3; // evidence days before the gap, so the return has a story

/** Local ISO days on which a goal produced evidence: a seen completion of a
 *  task it reaches, or a savings entry logged on it. */
export function goalEvidenceDays(
  goal: Goal,
  reach: GoalReach,
  samples: { id?: string; t: number }[],
): string[] {
  const ids = reachedIds(reach);
  const days = new Set<string>();
  for (const s of samples) {
    if (!s.id || !ids.has(s.id)) continue;
    const d = new Date(s.t);
    days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  for (const e of goal.data.saved ?? []) days.add(e.d);
  return [...days].sort();
}

export interface AreaPulse {
  fed: boolean;
  resting: boolean;
  /** Days since the newest evidence across the area's goals; null = none seen. */
  lastDays: number | null;
  /** True when chosen, awake, and quiet past the starved gate. */
  starved: boolean;
}

export function restingNow(area: Area, today: string): boolean {
  const until = area.data.restingUntil;
  return !!until && until >= today;
}

export function areaPulse(
  area: Area,
  evidenceDays: string[][],
  today: string,
): AreaPulse {
  const newest = evidenceDays.flat().sort().pop() ?? null;
  const lastDays = newest ? daysBetween(newest, today) : null;
  const resting = restingNow(area, today);
  const fed = lastDays != null && lastDays <= FED_DAYS;
  return {
    fed,
    resting,
    lastDays,
    // Starvation is only ever about areas the user CHOSE to keep alive, and
    // a resting area cannot starve: resting is the exit working.
    starved: !!area.data.chosen && !resting && !fed && (lastDays == null || lastDays >= STARVED_DAYS),
  };
}

/** The word an area wears. Silence-first: an unchosen quiet area says
 *  nothing at all, because JARVIS never invents an obligation. */
export function areaWord(p: AreaPulse): string | null {
  if (p.resting) return "Resting";
  if (p.fed) return "Fed";
  if (p.starved) return "Quiet a while";
  return null;
}

/** The comeback, generalized (pick 17): a return after a real gap, when the
 *  run before it was worth naming. Breines & Chen: compassion outperforms
 *  criticism at producing improvement, so the return leads as a win. */
export function comebackLine(evidenceDays: string[], today: string): string | null {
  const days = [...evidenceDays].sort();
  const newest = days[days.length - 1];
  if (!newest || daysBetween(newest, today) > 1) return null; // the return is now or it is not a return
  let gap = 0;
  let runBefore = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    const d = daysBetween(days[i]!, newest);
    if (gap === 0) {
      if (d < COMEBACK_GAP) return null; // no real gap behind the return
      gap = d;
      runBefore = 1;
    } else {
      runBefore++;
      if (runBefore >= COMEBACK_RUN) break;
    }
  }
  if (gap === 0 || runBefore < COMEBACK_RUN) return null;
  return capAfterNumber(`Back at it after ${gap - 1} quiet ${gap - 1 === 1 ? "day" : "days"}`);
}

/** Pick 18's fork, said out loud: effort without movement reads as weight,
 *  never as failure. Shown in the Life view in place of a bare Behind. */
export function heavyWord(health: "done" | "on_track" | "behind" | "idle" | "unmeasured", hasOpenWork: boolean): string | null {
  if ((health === "behind" || health === "idle") && hasOpenWork) return "Heavy right now";
  return null;
}
