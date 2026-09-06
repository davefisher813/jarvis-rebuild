// SAY IT TO SOMEONE (catalog Part 5). Always present, one tap, no
// preamble: the athlete's own chosen trusted adult plus 988. Never gated
// behind a mood question or any screener -- this file has no gating
// function on purpose, because there is nothing here to gate.

export const CRISIS_LINE_LABEL = "988 Suicide & Crisis Lifeline";
export const CRISIS_LINE_NUMBER = "988";

export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return "tel:" + digits;
}

// UP-ATH-05 (2026-09-06): the same normalisation, opening the composer with a
// body instead of placing a call. iOS accepts "&body=". Deliberately a second
// small copy of people/messageDraft.ts's smsLink rather than an import: this
// module's whole shape is that it reaches nothing outside itself (see
// HealthFlow's EXTERNAL CANDIDATES note), and two lines of link plumbing are
// a cheaper price than health importing people.
export function smsHref(phone: string, body: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return "sms:" + digits + (body ? "&body=" + encodeURIComponent(body) : "");
}

export function hasTrustedAdult(name: string, phone: string): boolean {
  return name.trim().length > 0 && phone.trim().length > 0;
}

// BRAIN-F-26 (2026-09-05, fork option A). The Point at It screen's "Hand It
// to Someone" dialled the constant above from anywhere on earth, and 988
// connects in exactly two countries. A number that does not connect is worse
// than no number, so this table holds only lines that can be stated as fact,
// and a region with no entry gets no dial at all (the caller hides the row
// rather than offering a dead end). The athlete's own trusted adult, when one
// is saved, always wins over any of them: it is the person they chose.
export interface CrisisLine { label: string; number: string }

const CRISIS_LINES: Record<string, CrisisLine> = {
  US: { label: CRISIS_LINE_LABEL, number: CRISIS_LINE_NUMBER },
  CA: { label: "988 Suicide Crisis Helpline", number: "988" },
  GB: { label: "Samaritans", number: "116123" },
  IE: { label: "Samaritans", number: "116123" },
  AU: { label: "Lifeline", number: "131114" },
  NZ: { label: "1737 Need to Talk", number: "1737" },
};

/** The two-letter region of a BCP 47 locale ("en-GB" -> "GB"), or null. */
export function regionOf(locale: string | undefined | null): string | null {
  if (!locale) return null;
  const parts = locale.replace(/_/g, "-").split("-");
  const region = parts.find((p) => /^[A-Za-z]{2}$/.test(p) && p !== parts[0]);
  return region ? region.toUpperCase() : null;
}

/** The line for a region, or null when there is none we can state. */
export function crisisLineFor(region: string | null): CrisisLine | null {
  return region ? CRISIS_LINES[region] ?? null : null;
}
