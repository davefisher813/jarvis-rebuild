// AMOUNTS, READ WITHOUT FLOATS (IMPLEMENTATION-SPEC.md 10.1 step 4). A money
// template needs an explicit currency and explicit total semantics. The
// number is read as digits and split at its decimal separator; it never
// passes through a float. A bare "$" names no currency, so the card asks; a
// "1,234" with no decimal part is a thousands group in one locale and a
// decimal in another, so it is ambiguous and the card asks. Nothing rounds.

export interface AmountHit {
  /** Integer minor units for a two-decimal reading, or null when the number is ambiguous. */
  minor_units: number | null;
  /** ISO 4217 when the text said it (a code, or a symbol that names one country), else null. */
  currency: string | null;
  raw: string;
  start: number;
  end: number;
  ambiguous: boolean;
}

const CODES = "USD|EUR|GBP|CAD|AUD|NZD|CHF|MXN|JPY|SEK|NOK|DKK";
const NUMBER = "\\d{1,3}(?:[,.\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const CODE_BEFORE = new RegExp(`\\b(${CODES})\\s?\\$?\\s?(${NUMBER})\\b`, "gi");
const SYMBOL_BEFORE = new RegExp(`(US\\$|CA\\$|C\\$|A\\$|NZ\\$|\\$|€|£)\\s?(${NUMBER})\\b`, "g");
const CODE_AFTER = new RegExp(`\\b(${NUMBER})\\s?(${CODES})\\b`, "gi");

const SYMBOL_CURRENCY: Record<string, string | null> = { "US$": "USD", "CA$": "CAD", "C$": "CAD", "A$": "AUD", "NZ$": "NZD", "€": "EUR", "£": "GBP", "$": null };

/** Digits to minor units, or null when the separators do not say which is which. */
export function readNumber(raw: string): { minor_units: number | null; ambiguous: boolean } {
  const s = raw.replace(/\s/g, "");
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let whole: string;
  let frac: string;
  if (commas && dots) {
    // Both present: the last separator is the decimal one.
    const dec = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    whole = s.slice(0, dec).replace(/[.,]/g, "");
    frac = s.slice(dec + 1);
  } else if (commas === 1 || dots === 1) {
    const sep = commas ? "," : ".";
    const [a, b = ""] = s.split(sep);
    if (b.length === 3) {
      // "1,234" or "1.234": a thousands group or a three-place decimal. Ask.
      return { minor_units: null, ambiguous: true };
    }
    whole = a!;
    frac = b;
  } else if (commas > 1 || dots > 1) {
    // "1,234,567": every group is thousands.
    whole = s.replace(/[.,]/g, "");
    frac = "";
  } else {
    whole = s;
    frac = "";
  }
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(frac)) return { minor_units: null, ambiguous: true };
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return { minor_units: null, ambiguous: true };
  return { minor_units: cents, ambiguous: false };
}

/** Every amount in the text, in order, each once. */
export function findAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const saidUsd = /\bUSD\b|\bUS dollars\b/i.test(text);
  const push = (raw: string, number: string, currency: string | null, start: number) => {
    if (hits.some((h) => start < h.end && start + raw.length > h.start)) return;
    const n = readNumber(number);
    hits.push({ minor_units: n.minor_units, currency, raw, start, end: start + raw.length, ambiguous: n.ambiguous });
  };
  for (const m of text.matchAll(CODE_BEFORE)) push(m[0], m[2]!, m[1]!.toUpperCase(), m.index!);
  for (const m of text.matchAll(CODE_AFTER)) push(m[0], m[1]!, m[2]!.toUpperCase(), m.index!);
  for (const m of text.matchAll(SYMBOL_BEFORE)) {
    const sym = m[1]!;
    const cur = sym === "$" ? (saidUsd ? "USD" : null) : SYMBOL_CURRENCY[sym] ?? null;
    push(m[0], m[2]!, cur, m.index!);
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** The first amount whose own line or the eighty characters before it carry one of the words. */
export function amountNear(hits: AmountHit[], text: string, words: RegExp): AmountHit | null {
  for (const h of hits) {
    const lineStart = text.lastIndexOf("\n", h.start) + 1;
    const context = text.slice(Math.max(lineStart, h.start - 80), h.start);
    if (words.test(context)) return h;
  }
  return null;
}
