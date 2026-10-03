import type { RecurringSuggestion } from "./ledger/recurring";

// "NOT NOW" IS REMEMBERED (Money ledger, lane B). A recurring-bill suggestion
// the person waved off must not come back the next time the page renders. It is
// kept for the session (this tab's sessionStorage, plus memory for where that is
// blocked) and not longer: a fresh session may ask once more, and nothing is
// scheduled by asking. The key is the pattern (vendor and amount), not the bill,
// because next month's bill is a new record with the same pattern.

const KEY = "jarvis.money.recurring.dismissed.v1";
const memory = new Set<string>();

export function suggestionKey(s: Pick<RecurringSuggestion, "vendor" | "amountCents">): string {
  return `${s.vendor.trim().toLowerCase()}|${s.amountCents}`;
}

function stored(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isSuggestionDismissed(key: string): boolean {
  return memory.has(key) || stored().includes(key);
}

export function dismissSuggestion(key: string): void {
  memory.add(key);
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...new Set([...stored(), key])]));
  } catch { /* blocked storage: the in-memory copy still holds for this session */ }
}
