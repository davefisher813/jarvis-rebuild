// EXPLICIT DATES ONLY (ledger, hard rule 3).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day. 2026-02-31 is not one. */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Both must be real dates. */
export function dayGap(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export const monthOfDay = (iso: string): string => iso.slice(0, 7);
