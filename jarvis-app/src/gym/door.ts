import type { Program, Workout, ProgramDay } from "./types";
import type { RackConfig } from "./ramp";
import { pinnedTo } from "./pins";
import { estimateDay } from "./fit";
import { agoPhraseLower } from "./summary";

// THE TRAINING DOOR's facts (D4-C, Training Catalog V2, approved
// 2026-08-31): "your existing gym block becomes the door: it names the
// day's lift, taps straight into the session." This is the naming half --
// pure derivation from the athlete's own pins, so the calendar never
// invents a lift. No pin for that weekday, no claim (the door still opens
// the gym; the gym asks once).

export interface DoorInfo { day: ProgramDay; meta: string }

/** Weekday of a local ISO date, Mon=0..Sun=6 (the gym's own convention). */
export function dowOfIso(iso: string): number {
  return (new Date(iso + "T12:00:00").getDay() + 6) % 7;
}

export function doorInfoFor(
  programs: Program[],
  activeProgramId: string | null,
  history: Workout[],
  rack: RackConfig,
  dateIso: string,
): DoorInfo | null {
  const program = (activeProgramId ? programs.find((p) => p.id === activeProgramId) : undefined)
    ?? programs.find((p) => !p.data.archived) ?? programs[0];
  if (!program) return null;
  const days = program.data.weeks.flatMap((w) => w.days);
  const day = pinnedTo(days, dowOfIso(dateIso));
  if (!day) return null;
  const est = estimateDay(day, history, rack).min;
  let last: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.data.dayId === day.id) { last = history[i]!.data.date; break; }
  }
  const meta = [
    `${day.exercises.length} ${day.exercises.length === 1 ? "exercise" : "exercises"}`,
    est > 0 ? `Est ${est} min` : null,
    // Live-render audit 2026-09-01: monthDay said "Last trained Aug 31" ON
    // Aug 31 while the Health page said "Today" for the same session. One
    // clock, one phrase: agoPhrase, lowercased where it is a relative word.
    last ? `Last trained ${agoPhraseLower(last, dateIso)}` : null,
  ].filter(Boolean).join(" · ");
  return { day, meta };
}
