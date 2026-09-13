import type { TookItEntry, MedDefEntry } from "./types";
import { shortDateFromMs } from "../shared/dateFormat";

// MEDICATION BY NAME AND AMOUNT (Health Push D, H-38, Dave's picks
// 2026-09-12; Dave 2026-09-13: "I just want people to be able to log and
// track things"). Pure helpers over the dose log and the configured meds.
//
// What is NOT here, on purpose: a schedule, a next-dose time, a count per
// day, anything a tap could fall short of. The one guard below is the
// opposite of a reminder: it asks before logging the SAME med twice inside
// ten minutes, because a double tap is the likeliest way a wrong row lands,
// and it never says a dose is due.

export const DOSE_REPEAT_MS = 10 * 60_000;

/** One dose as the screens draw it: the med's name resolved, pending flagged
 *  so a row still on its way to the store offers no Undo by id. */
export interface DoseRow {
  id: string;
  at: number;
  medId?: string;
  amount?: string;
  name: string;
  pending?: boolean;
}

export function doseRows(entries: (TookItEntry & { pending?: boolean })[], defs: MedDefEntry[]): DoseRow[] {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  return entries
    .map((e): DoseRow => {
      const def = e.data.medId ? byId.get(e.data.medId) : undefined;
      return {
        id: e.id,
        at: e.data.at,
        ...(e.data.medId ? { medId: e.data.medId } : {}),
        ...(e.data.amount ?? def?.data.amount ? { amount: e.data.amount ?? def?.data.amount } : {}),
        name: def?.data.name ?? "Dose",
        ...(e.pending ? { pending: true } : {}),
      };
    })
    .sort((a, b) => a.at - b.at);
}

/** The most recent dose, of one med when `medId` is given. */
export function lastDose<T extends { at: number; medId?: string }>(rows: T[], medId?: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (medId !== undefined && r.medId !== medId) continue;
    if (!best || r.at > best.at) best = r;
  }
  return best;
}

/** The dose of this med logged inside the window before `now`, or null. With
 *  no med (the one-row Log a Dose page) any dose counts. This is the whole
 *  ten-minute guard: a second tap this close asks "Log Another?" first. */
export function repeatWithin<T extends { at: number; medId?: string }>(rows: T[], medId: string | undefined, now: number, windowMs: number = DOSE_REPEAT_MS): T | null {
  const last = lastDose(rows, medId);
  if (!last) return null;
  return now - last.at >= 0 && now - last.at < windowMs ? last : null;
}

/** The receipt a dose toasts, with the amount when there is one. */
export function doseToast(amount?: string): string {
  return amount ? "Dose logged · " + amount : "Dose logged";
}

export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "8:05 AM" today, the short date otherwise: the Last fact on a med row. */
export function whenShort(at: number, now: number = Date.now()): string {
  return sameLocalDay(at, now) ? clockOf(at) : shortDateFromMs(at);
}
