import type { RoutineData } from "../routine/types";

// Energy-aware planning. The idea: hard, demanding work belongs in the hours
// the user actually has focus, and light admin belongs in the dips. We do not
// ask the user their chronotype: we infer it from the routine they already
// gave us, then hand that window to the AI planner so it orders accordingly.
// Phase 2.

export type Chronotype = "morning" | "evening" | "neutral";
export interface EnergyWindow { s: number; e: number }

// When does focus peak? An early work start or early wake reads as a morning
// person; a late start or late wake reads as an evening person. The onboarding
// "workstyle" answer is not stored, but its effect on wake and work hours is,
// so this reads the same signal without adding a field. Everyone else is
// neutral and gets no reordering pressure.
export function chronotypeFor(r: RoutineData): Chronotype {
  if (r.workStartMin <= 8 * 60 || r.wakeMin <= 6 * 60 + 30) return "morning";
  if (r.workStartMin >= 11 * 60 || r.wakeMin >= 8 * 60 + 30) return "evening";
  return "neutral";
}

// A roughly three-hour peak-focus window inside the user's work hours: near the
// start for morning people, near the end for evening people, mid for neutral.
// Always clamped inside work hours so it can never invert or spill out.
export function peakWindowFor(r: RoutineData, t: Chronotype = chronotypeFor(r)): EnergyWindow {
  const ws = r.workStartMin;
  const we = Math.max(ws + 60, r.workEndMin);
  const span = Math.min(180, we - ws);
  if (t === "evening") return { s: we - span, e: we };
  if (t === "morning") return { s: ws, e: ws + span };
  const s = Math.min(we - span, ws + 60);
  return { s: Math.max(ws, s), e: Math.min(we, Math.max(ws, s) + span) };
}
