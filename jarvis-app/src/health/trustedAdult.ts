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

export function hasTrustedAdult(name: string, phone: string): boolean {
  return name.trim().length > 0 && phone.trim().length > 0;
}
