// READ A RECEIPT (UP-CORE-13, 2026-09-05).
//
// The Privacy Policy already promises this in so many words: "Statements and
// documents you upload for extraction are processed to create the records you
// review" (settings/PrivacyPage.tsx:19). Receipts have been uploadable since
// the Money page got its clip, and nothing has ever read one, so a
// photographed receipt was a picture and the amount was still typed by hand.
//
// The same distillation the schedule and syllabus uploads use: extract, and
// then a REVIEW that a person confirms. Nothing here writes anything; the
// bill sheet opens prefilled and Save is still a tap.
//
// Three refusals, and each is the difference between a record and a guess:
//   - the vendor is the source's own words, never tidied into a brand name
//   - a total that is not a number is no total, and the sheet opens with the
//     amount blank rather than with a plausible one
//   - a date the receipt does not state is not invented; the review falls
//     back to today, which is the one date the person can check at a glance
//
// No bank data, no transaction sync, no balance is inferred. The honest-money
// law stands: balances are self-reported and this only ever produces one
// paid bill that a person confirmed.

export const RECEIPT_EXTRACT_PROMPT = [
  "Read this receipt.",
  "Reply with ONLY a JSON object, no prose, no code fences, in exactly this shape:",
  '{"vendor":"...","total":42.75,"date":"2026-09-05","currency":"USD"}',
  "vendor is the shop or company name as printed. Do not expand or correct it.",
  "total is the FINAL amount paid, as a number, including tax and tip. Use null if it is not legible.",
  'date is the purchase date as "YYYY-MM-DD", or null if the receipt does not state one. Do not guess a date.',
  "currency is the 3-letter code if the receipt states one, else null.",
].join("\n");

export interface ReceiptRead {
  vendor: string;
  total: number | null;
  date: string | null;
  currency: string | null;
}

const MAX_VENDOR = 60;
const MAX_TOTAL = 1_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A total is money: finite, above zero, and not an absurdity. A negative or a
// million-dollar coffee is a mis-read, and a mis-read total is worse than a
// blank one, because a blank one gets typed.
function cleanTotal(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(String(x).replace(/[^\d.-]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_TOTAL) return null;
  return Math.round(n * 100) / 100;
}

// A real calendar date, or nothing. Feb 30 on a smudged receipt is a mis-read.
function cleanDate(x: unknown): string | null {
  if (typeof x !== "string" || !DATE_RE.test(x)) return null;
  const [y, m, d] = x.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return x;
}

export function parseReceiptExtract(raw: string): ReceiptRead | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as { vendor?: unknown; total?: unknown; date?: unknown; currency?: unknown };
  const vendor = typeof o.vendor === "string" ? o.vendor.trim().slice(0, MAX_VENDOR) : "";
  const total = cleanTotal(o.total);
  // Neither a name nor an amount is not a receipt read, it is a shrug, and
  // the caller says so rather than opening an empty sheet.
  if (!vendor && total === null) return null;
  const currency = typeof o.currency === "string" && /^[A-Za-z]{3}$/.test(o.currency.trim())
    ? o.currency.trim().toUpperCase() : null;
  return { vendor, total, date: cleanDate(o.date), currency };
}
