import { formatMoney } from "./types";
import { capAfterNumber } from "../shared/casing";

// BUDGETING, the honest kind.
//
// A normal budget app says "you have spent $340 of your $500 grocery budget."
// JARVIS has no transaction feed, so it cannot know that, and the money laws
// forbid claiming spend without an upload or a sync. Making the user log every
// purchase by hand is the same feature with an extra chore that dies in a week.
//
// So this answers the one question the app CAN answer truthfully, which is
// also the only one that matters day to day: after the bills you told me about
// and the money you deliberately set aside, what is actually yours until the
// next paycheck.
//
// Set-aside envelopes are a PLAN, never a claim. "Groceries $300" means you
// decided to reserve it, not that you spent it. That distinction is what keeps
// this honest, and the copy must never blur it.

export interface Envelope { id: string; name: string; amount: number }

const KEY = "jarvis.money.envelopes.v1";
const CAP = 20;
const MAX = 1_000_000;

// HMN-F-12 (2026-09-05), option A: envelopes live on the profile record now,
// so the sanitising half of saveEnvelopes is its own function and the caller
// writes the result wherever it keeps them. loadEnvelopes and saveEnvelopes
// stay for the one-time lift of what this device already had.
export function cleanEnvelopes(list: Envelope[]): Envelope[] {
  return list
    .filter((e) => e.name.trim() && e.amount > 0)
    .map((e) => ({ id: e.id, name: e.name.trim().slice(0, 40), amount: Math.min(MAX, Math.round(e.amount)) }))
    .slice(0, CAP);
}

export function loadEnvelopes(): Envelope[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Envelope =>
        !!e && typeof e === "object" &&
        typeof (e as Envelope).id === "string" &&
        typeof (e as Envelope).name === "string" &&
        typeof (e as Envelope).amount === "number" && isFinite((e as Envelope).amount))
      .slice(0, CAP);
  } catch {
    return [];
  }
}

export function saveEnvelopes(list: Envelope[]): Envelope[] {
  const clean = cleanEnvelopes(list);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private mode */ }
  return clean;
}

/** HMN-F-12: the device's old copy, cleared once it has been lifted onto the
 *  profile, so the migration cannot run twice and a later local edit by an
 *  older build cannot come back to life. */
export function forgetLocalEnvelopes(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// HMN-F-25 (2026-09-05): the id was built from `envelopes.length + Date.now()
// % 9999`, and two envelopes added in the same millisecond bucket at the same
// list length shared one, so removing either removed both. Same generator the
// rest of the app uses for a local id (NotesService.genId).
export function envelopeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return "env_" + crypto.randomUUID();
  return "env_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function setAsideTotal(list: Envelope[]): number {
  return list.reduce((sum, e) => sum + (isFinite(e.amount) ? e.amount : 0), 0);
}

export interface Left {
  amount: number;      // what is actually his
  paycheck: number;
  billsOut: number;
  setAside: number;
  short: boolean;      // bills alone exceed the paycheck
}

export function leftToSpend(paycheck: number, billsOut: number, setAside: number): Left {
  // 2026-09-11: to the cent, like the rows above it (HMN-F-25, option B).
  // Whole dollars made Yours disagree with the bills it was computed from.
  const amount = Math.round((paycheck - billsOut - setAside) * 100) / 100;
  return { amount, paycheck, billsOut, setAside, short: paycheck - billsOut < 0 };
}

// The line under the number. Derived from what he entered, or absent.
export function leftSub(l: Left): string {
  const bits: string[] = [];
  if (l.billsOut > 0) bits.push(formatMoney(l.billsOut) + " of bills");
  if (l.setAside > 0) bits.push(formatMoney(l.setAside) + " set aside");
  return bits.length ? "After " + bits.join(" and ") : "";
}

// Overspend is stated in words and never dressed up in red, the same way an
// overdue bill is. It is information, not an alarm.
export function shortLine(l: Left): string {
  if (l.amount >= 0) return "";
  return formatMoney(Math.abs(l.amount)) + " past this paycheck";
}

// Days remaining is inclusive of today: with payday tomorrow you still have to
// eat today. Returns 0 when the date is unreadable rather than guessing.
export function daysUntil(todayISO: string, paydayISO: string): number {
  const a = Date.parse(todayISO + "T00:00:00Z");
  const b = Date.parse(paydayISO + "T00:00:00Z");
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// "about $29 a day" only when it is a real number over a real span. Never
// shown when he is short: telling someone with nothing left how little they
// have per day is the app scolding him with arithmetic.
export function perDayLine(l: Left, days: number): string {
  if (l.amount <= 0 || days <= 1) return "";
  const per = Math.floor(l.amount / days);
  if (per <= 0) return "";
  return capAfterNumber(days + " days, about " + formatMoney(per) + " a day");
}
