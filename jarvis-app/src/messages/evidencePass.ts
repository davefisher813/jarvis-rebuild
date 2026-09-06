import { anchorClaims, type EvidenceAsk, type EvidenceMessage } from "./evidence";
import type { TriageMap } from "./triage";

// THE SECOND PASS (UP-MIND-12, the E6 fork, option B).
//
// Triage is shown a 200-character snippet per thread and nothing more, which
// is deliberate: it is one call for a whole inbox and full bodies would make
// it enormous. The price is that most claims cannot be anchored there, so a
// deadline chip would appear on maybe half of them.
//
// The chosen option pays for the other half where it is cheap to: only for
// threads that NEED the user, only for claims that are still unanchored, and
// only over the bodies the app fetches anyway when one of those threads is
// opened. Capped per pass, because an inbox that suddenly has forty threads
// needing an answer must not become forty fetches.
//
// Nothing here decides anything. It fills in evidence for claims triage
// already made; a claim it cannot anchor is left exactly as it was.

export interface FullThread { id: string; messages: EvidenceMessage[] }

type Complete = (messages: { role: string; content: string }[], system: string) => Promise<string>;

/** How many threads one pass will fetch. Four is the whole Needs You band on
 *  a normal morning; past that the rest wait for the next refresh, or for the
 *  user to open the thread, which fetches it anyway. */
export const ANCHOR_CAP = 4;

export function needsAnchor(map: TriageMap, id: string): boolean {
  const t = map[id];
  if (!t || t.bucket !== "needs_you") return false;
  return (!!t.by && !t.byEv) || (!!t.act && !t.actEv);
}

/** Fills in the evidence triples for the needs-you threads whose claims are
 *  still unanchored. Returns a NEW map; the input is never mutated, so a
 *  failed pass leaves the caller's map exactly as it was. */
export async function anchorNeedsYou(
  rows: { id: string; account?: string }[],
  map: TriageMap,
  fetchThread: (id: string, account?: string) => Promise<FullThread | null>,
  complete?: Complete,
  cap = ANCHOR_CAP,
): Promise<TriageMap> {
  const targets = rows.filter((r) => needsAnchor(map, r.id)).slice(0, cap);
  if (targets.length === 0) return map;
  const out: TriageMap = { ...map };
  for (const r of targets) {
    const t = out[r.id];
    if (!t) continue;
    let full: FullThread | null = null;
    try {
      full = await fetchThread(r.id, r.account);
    } catch {
      // A thread we could not fetch keeps its unanchored claims. Silence is
      // correct here: nothing on screen changed, so nothing needs a receipt.
      continue;
    }
    if (!full || full.messages.length === 0) continue;
    const asks: EvidenceAsk[] = [];
    if (t.by && !t.byEv) asks.push({ key: "by", phrase: t.by });
    // The act's own words are the best phrase to hunt for: the title is what
    // the model wrote, the date is normalised, and neither is likely to be in
    // the mail character for character. The title still gives the free half
    // something to find, and the model half gets the whole claim.
    if (t.act && !t.actEv) asks.push({ key: "act", phrase: [t.act.title, t.act.date].filter(Boolean).join(" ") });
    if (asks.length === 0) continue;
    const found = await anchorClaims({ messages: full.messages, asks, complete });
    if (!found.by && !found.act) continue;
    out[r.id] = {
      ...t,
      ...(found.by ? { byEv: found.by } : {}),
      ...(found.act ? { actEv: found.act } : {}),
    };
  }
  return out;
}
