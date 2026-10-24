import type { DocText, ExtractedItem, FieldEnvelope, VerifiedField } from "./types";

// CONFIDENCE IS COMPUTED, NEVER CLAIMED (build order, extraction). The model returns a value, the words it came from, a page and a
// basis. Whether to believe it is decided here, by checks that cannot be talked into anything: is the quote really in the document,
// is the value really in the quote, is the format valid, do the line items add up, is the date sane. A field that fails the
// quote or the value check is dropped (an amount or date) or demoted (a word). Pure, shared by the worker and the tests.

export type ValueType = "money" | "date" | "time" | "text";

/** What kind of value each key holds. A key not listed is text. Amounts, dates and times are the strict ones. */
export const FIELD_TYPES: Record<string, ValueType> = {
  amount: "money", minimumDue: "money", lineAmount: "money",
  dueDate: "date", statementDate: "date", date: "date",
  startTime: "time", endTime: "time",
};
export const typeOf = (key: string): ValueType => FIELD_TYPES[key] ?? "text";

// ---------------------------------------------------------------------------
// Matching a quote to the document.

/** One character's comparable form: NFKC, smart punctuation flattened. Whitespace is handled by the caller. */
function flat(ch: string): string {
  const n = ch.normalize("NFKC");
  return n
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, "-");
}

/** The text with every run of whitespace as one space, plus where each comparable character came from in the original. */
export function comparable(text: string): { norm: string; from: number[] } {
  let norm = "";
  const from: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!lastSpace) { norm += " "; from.push(i); lastSpace = true; }
      continue;
    }
    const f = flat(ch);
    for (const c of f) { norm += c; from.push(i); }
    lastSpace = false;
  }
  return { norm, from };
}

/** Where the quote sits in the document, as offsets into the ORIGINAL text, or null when it is not there. */
export function findQuote(doc: string, quote: string): { start: number; end: number } | null {
  const q = comparable(quote).norm.trim();
  if (q.length < 2) return null;
  const d = comparable(doc);
  const at = d.norm.indexOf(q);
  if (at < 0) return null;
  const start = d.from[at]!;
  const last = d.from[at + q.length - 1]!;
  return { start, end: last + 1 };
}

/** The page a character offset falls on, by the document's own page map. */
export function pageAt(doc: DocText, offset: number): number | null {
  for (const p of doc.pages) if (offset >= p.start && offset < p.end) return p.page;
  return doc.pages.length ? doc.pages[doc.pages.length - 1]!.page : null;
}

// ---------------------------------------------------------------------------
// Values.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNo = (w: string): number => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;

export function parseMoney(s: string): number | null {
  const m = s.replace(/ /g, " ").match(/-?\$?\s?\d[\d,]*(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0].replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Every money amount written in a passage. */
export function moneyIn(passage: string): number[] {
  const out: number[] = [];
  for (const m of passage.replace(/ /g, " ").matchAll(/\$?\s?\d[\d,]*(?:\.\d{1,2})?/g)) {
    const n = Number(m[0].replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

export interface DateToken { iso: string | null; month: number; day: number; hasYear: boolean }

/** Every date written out in a passage. A date with no year says so (hasYear false): the year is then NOT in the quote. */
export function datesIn(passage: string): DateToken[] {
  const out: DateToken[] = [];
  const p = passage.replace(/ /g, " ");
  const push = (y: number | null, m: number, d: number) => out.push({ iso: y === null ? null : iso(y, m, d), month: m, day: d, hasYear: y !== null });
  for (const m of p.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(+m[1]!, +m[2]!, +m[3]!);
  for (const m of p.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)) push(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[1]!, +m[2]!);
  for (const m of p.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi)) push(m[3] ? +m[3] : null, monthNo(m[1]!), +m[2]!);
  for (const m of p.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/gi)) push(m[3] ? +m[3] : null, monthNo(m[2]!), +m[1]!);
  for (const m of p.matchAll(/\b(\d{1,2})\/(\d{1,2})(?!\/|\d)/g)) push(null, +m[1]!, +m[2]!);
  return out;
}

/** Every clock time written in a passage, as HH:MM (24-hour). */
export function timesIn(passage: string): string[] {
  const out: string[] = [];
  for (const m of passage.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/gi)) {
    let h = +m[1]!;
    const pm = /^p/i.test(m[3]!);
    if (h < 1 || h > 12) continue;
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    out.push(`${pad(h)}:${m[2] ?? "00"}`);
  }
  for (const m of passage.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm))/gi)) out.push(`${pad(+m[1]!)}:${m[2]}`);
  return out;
}

const HEDGE = /\b(approx(?:imately)?|estimated?|about|around|roughly|tentative(?:ly)?|tbd|tbc|to be (?:determined|confirmed)|subject to change|may|might|if|unless|pending|expected)\b/i;
const SUBTOTAL = /\b(sub-?total|tax|fee|previous balance|balance forward|past due|credit|discount|savings|minimum)\b/i;
const LABELS = /^(amount due|amount|due date|due|total|total due|date|name|payee|balance|account|account number|pay to|bill to|statement date|n\/a|none)\b:?$/i;

/** True when a value is just a form label ("Amount Due"), which is what a form's caption looks like when it is read as an answer. */
export const looksLikeLabel = (value: string): boolean => LABELS.test(value.trim());

// ---------------------------------------------------------------------------
// One field.

export interface VerifyContext { doc: DocText; today: Date }

const yearsFromToday = (isoDate: string, today: Date): number => (new Date(isoDate + "T12:00:00").getTime() - today.getTime()) / (365.25 * 86400000);

function drop(env: FieldEnvelope, why: string): VerifiedField {
  return { ...env, tier: "dropped", reasons: [why], offsets: null };
}

export function verifyField(env: FieldEnvelope, ctx: VerifyContext): VerifiedField {
  const type = typeOf(env.key);
  const value = (env.value ?? "").trim();
  const quote = (env.quote ?? "").trim();
  if (!value) return drop(env, "No value.");

  // LAW 4: an amount, date or time is never inferred. It is written in the document or it is not a fact.
  if (type !== "text" && env.basis === "inferred") return drop(env, "An amount or date can't be inferred; it has to be written in the document.");
  // LAW 5: no verifiable quote, no fact.
  const offsets = quote ? findQuote(ctx.doc.text, quote) : null;
  if (!offsets) return drop(env, "The words it quotes are not in the document.");
  const reasons: string[] = [];
  let weak = false;
  const need = (why: string) => { weak = true; reasons.push(why); };

  if (looksLikeLabel(value)) return drop(env, "That is a form label, not an answer.");

  if (type === "money") {
    const n = parseMoney(value);
    if (n === null || !Number.isFinite(n)) return drop(env, "Not an amount.");
    if (n < 0 || n > 10_000_000) return drop(env, "That amount is outside anything sensible.");
    if (env.basis === "stated" || env.basis === "computed") {
      if (env.basis === "stated" && !moneyIn(quote).some((q) => Math.abs(q - n) < 0.005)) return drop(env, "The amount is not in the words it quotes.");
    }
    if (env.basis === "computed") need("Worked out by JARVIS, not written in the document.");
    if (SUBTOTAL.test(quote) && (env.key === "amount")) need("The quote reads like a subtotal, a fee or a minimum, not the total.");
  } else if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !iso(+value.slice(0, 4), +value.slice(5, 7), +value.slice(8, 10))) return drop(env, "Not a real date.");
    const year = +value.slice(0, 4);
    if (year < 2000 || year > 2100) return drop(env, "That year is outside anything sensible.");
    const toks = datesIn(quote);
    const exact = toks.some((t) => t.iso === value);
    const noYear = toks.some((t) => !t.hasYear && t.month === +value.slice(5, 7) && t.day === +value.slice(8, 10));
    if (!exact && !noYear) return drop(env, "The date is not written out in the words it quotes.");
    if (!exact && noYear) need("The year is not in the words it quotes.");
    const away = yearsFromToday(value, ctx.today);
    if (away < -2 || away > 2) need("That date is more than two years from today.");
    if (env.basis === "computed") need("Worked out by JARVIS, not written in the document.");
  } else if (type === "time") {
    if (!/^\d{2}:\d{2}$/.test(value)) return drop(env, "Not a clock time.");
    if (!timesIn(quote).includes(value)) return drop(env, "The time is not in the words it quotes.");
  } else {
    const comp = (s: string) => comparable(s).norm.toLowerCase();
    if (!comp(quote).includes(comp(value))) need("The value is not in the words it quotes.");
    if (env.basis === "inferred") need("JARVIS inferred this; the document does not say it.");
  }

  if (HEDGE.test(quote) && type !== "text") need("The document hedges this (" + (quote.match(HEDGE)![0].toLowerCase()) + ").");
  const page = pageAt(ctx.doc, offsets.start);
  return { ...env, page, tier: weak ? "uncertain" : "solid", reasons, offsets };
}

// ---------------------------------------------------------------------------
// One item (a bill, an event): the checks that need more than one field.

/** Line items must add up to the total. When they do not, the total and the lines come out of the batch. */
export function checkArithmetic(item: ExtractedItem): ExtractedItem {
  const lines = item.fields.filter((f) => f.key === "lineAmount" && f.tier !== "dropped");
  const total = item.fields.find((f) => f.key === "amount" && f.tier !== "dropped");
  if (lines.length < 2 || !total) return item;
  const sum = lines.reduce((t, f) => t + (parseMoney(f.value) ?? 0), 0);
  const want = parseMoney(total.value) ?? 0;
  if (Math.abs(sum - want) <= 0.01) return item;
  const why = `The line items add to ${sum.toFixed(2)} but the total says ${want.toFixed(2)}.`;
  return {
    ...item,
    fields: item.fields.map((f) => (f === total || lines.includes(f)) && f.tier === "solid" ? { ...f, tier: "uncertain" as const, reasons: [...f.reasons, why] } : f),
  };
}

export function verifyItem(group: string, envs: FieldEnvelope[], ctx: VerifyContext): ExtractedItem {
  return checkArithmetic({ group, fields: envs.map((e) => verifyField(e, ctx)) });
}
