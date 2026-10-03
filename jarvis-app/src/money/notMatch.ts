// "NOT A MATCH" IS REMEMBERED (Money ledger, 2026-10-03). A proposal the person
// turned down must not come back every time the screen opens. The memory is a
// list of record|transaction pairs on this device: it is a convenience over the
// proposals, not a fact about the money, so nothing is written to the ledger.
//
// Storage can be absent or throw (private window, cleared data); then the
// proposal simply returns, which is the safe failure.

export const NOT_MATCH_KEY = "jarvis.money.notMatch.v1";

export const pairKey = (recordId: string, transactionId: string): string => `${recordId}|${transactionId}`;

export function loadNotMatches(): Set<string> {
  try {
    const raw = localStorage.getItem(NOT_MATCH_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberNotMatch(recordId: string, transactionId: string): Set<string> {
  const all = loadNotMatches();
  all.add(pairKey(recordId, transactionId));
  try { localStorage.setItem(NOT_MATCH_KEY, JSON.stringify([...all])); } catch { /* not stored: it may return, which is safe */ }
  return all;
}
