// The spending-limit field's text to integer micro-USD. Strings and integer
// arithmetic only, so "4.10" is 4,100,000 exactly and never 4,099,999.99.
// null means the text is not an amount the screen will save (empty, negative,
// more than cents, or over the most the server accepts).

export const MAX_LIMIT_DOLLARS = 1000;

export function parseDollarsToMicro(text: string): number | null {
  const m = /^\$?(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (dollars * 100 + cents > MAX_LIMIT_DOLLARS * 100) return null;
  return dollars * 1_000_000 + cents * 10_000;
}
