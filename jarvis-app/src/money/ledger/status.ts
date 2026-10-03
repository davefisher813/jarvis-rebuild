import { dayGap, isRealDate } from "./dates";
import { DUE_SOON_DAYS, type BillData, type BillStatus } from "./types";

// A BILL'S STATUS, COMPUTED AT READ TIME (spec section 2.1). Never stored,
// never a guess: it is a function of the explicit due date, the explicit paid
// date and the evidence, and of nothing else.
//
//   paid     a paid date AND evidence, and no pending re-confirmation
//   overdue  a real due date before today, not paid
//   due      a real due date today or within the next 7 days, not paid
//   unpaid   everything else, including a bill with no due date
//
// A bill with no due date is never overdue and never due. A paid date with no
// evidence is not paid: it is data that should not exist, and it reads as the
// unpaid bill it really is (the service refuses to write one; this is the
// second wall).

type StatusFields = Pick<BillData, "dueDate" | "paidAt" | "paidEvidence" | "paidNeedsReconfirm">;

export function isPaid(b: StatusFields): boolean {
  return !!b.paidAt && !!b.paidEvidence && !b.paidNeedsReconfirm;
}

export function billStatus(b: StatusFields, today: string): BillStatus {
  if (isPaid(b)) return "paid";
  if (!b.dueDate || !isRealDate(b.dueDate)) return "unpaid";
  const gap = dayGap(today, b.dueDate);
  if (gap < 0) return "overdue";
  if (gap <= DUE_SOON_DAYS) return "due";
  return "unpaid";
}

/** The overdue set, from explicit due dates only. The one place "overdue" is
 *  decided, so the badge, Today and Money cannot disagree. */
export function overdueBills<T extends { data: StatusFields }>(bills: T[], today: string): T[] {
  return bills.filter((b) => billStatus(b.data, today) === "overdue");
}

/** Whole days late, for the plain line "3 days late". Null unless overdue. */
export function daysLate(b: StatusFields, today: string): number | null {
  if (billStatus(b, today) !== "overdue" || !b.dueDate) return null;
  return -dayGap(today, b.dueDate);
}
