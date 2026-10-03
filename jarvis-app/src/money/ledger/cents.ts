// MONEY IN AND OUT OF WORDS, STRICT (ledger).
//
// tracker.ts's dollarsToCents reads junk as 0, which is right for a screen that
// will not save a zero. A ledger write needs the refusal itself: a typed
// "12.5x" is not twelve dollars fifty, and a stored amount is never a guess.

const MAX_CENTS = 1_000_000_000; // ten million dollars

/** A typed amount to integer cents, or null when it is not a plain positive
 *  amount. Accepts "1,234.50", "$12", 12.5. Rejects NaN, zero, negatives,
 *  more than two decimals, and anything with stray text. */
export function parseCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let cents: number;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // A computed amount carries float noise (0.1 + 0.2); a real third decimal
    // does not round away, so it is refused rather than quietly shaved.
    cents = Math.round(input * 100);
    if (Math.abs(input * 100 - cents) > 1e-6) return null;
  } else {
    const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(s) && !/^\d*\.\d{1,2}$/.test(s)) return null;
    cents = Math.round(parseFloat(s) * 100);
  }
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** Cents back to the dollars a field shows: "12.50", never "12.5". */
export function centsToField(cents: number): string {
  return (cents / 100).toFixed(2);
}
