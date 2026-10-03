import { parseCents } from "./cents";
import { isRealDate } from "./dates";
import { DEFAULT_CURRENCY } from "./types";

// WHAT A MONEY RECORD MUST BE BEFORE IT IS WRITTEN (spec sections 2.1 to 2.3).

let ISO_CODES: Set<string> | null = null;
const FALLBACK = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CHF", "CNY", "INR", "MXN", "BRL", "SEK", "NOK", "DKK", "PLN", "SGD", "HKD", "KRW", "ZAR", "ILS", "AED", "THB", "TRY"];

/** A real ISO 4217 code. The platform's own list when it has one. */
export function isCurrencyCode(c: unknown): c is string {
  if (typeof c !== "string" || !/^[A-Z]{3}$/.test(c)) return false;
  if (!ISO_CODES) {
    let list: string[] = FALLBACK;
    try {
      const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      if (f) list = f("currency");
    } catch { /* an older engine: the fallback list stands */ }
    ISO_CODES = new Set(list);
  }
  return ISO_CODES.has(c);
}

/** Uppercased, defaulted to USD when blank, or null when invalid. */
export function cleanCurrency(c: string | undefined | null): string | null {
  const s = (c ?? "").trim().toUpperCase();
  if (!s) return DEFAULT_CURRENCY;
  return isCurrencyCode(s) ? s : null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface RecordInput {
  vendor?: string;
  amount?: string | number | null;
  currency?: string | null;
}

/** The three fields every money record shares. Vendor is kept exactly as the
 *  person wrote it (trimmed at the ends, nothing tidied). */
export function checkCore(i: RecordInput): Checked<{ vendor: string; amountCents: number; currency: string }> {
  const errors: string[] = [];
  const vendor = (i.vendor ?? "").trim();
  if (!vendor) errors.push("vendor");
  const amountCents = parseCents(i.amount ?? null);
  if (amountCents === null) errors.push("amount");
  const currency = cleanCurrency(i.currency);
  if (currency === null) errors.push("currency");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { vendor, amountCents: amountCents!, currency: currency! } };
}

/** A date that is real, or nothing. A blank, a guess and a malformed string all
 *  come back as undefined for an optional date, never as a stand-in. */
export function optionalDate(s: string | null | undefined): { ok: true; value: string | undefined } | { ok: false } {
  const t = (s ?? "").trim();
  if (!t) return { ok: true, value: undefined };
  return isRealDate(t) ? { ok: true, value: t } : { ok: false };
}
