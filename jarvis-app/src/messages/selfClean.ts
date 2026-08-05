// Self-cleaning inbox: the app notices what you keep throwing away.
//
// When a sender has been archived UNREAD several times, that is a decision
// already made, repeatedly, by hand. JARVIS offers once to make it permanent.
//
// Offer law: one line, one action, quiet dismiss, and never asked twice about
// the same sender whatever the answer was.

const KEY = "jarvis.mail.tossed.v1";
const ASKED = "jarvis.mail.tossasked.v1";
export const TOSS_THRESHOLD = 4;
const CAP = 200;

export type TossCounts = Record<string, number>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadTossed(): TossCounts {
  const v = read<TossCounts>(KEY, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function loadAsked(): string[] {
  const v = read<string[]>(ASKED, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function trim(counts: TossCounts): TossCounts {
  const keys = Object.keys(counts);
  if (keys.length <= CAP) return counts;
  // Drop the smallest counts first: they are the least likely to ever matter.
  const ordered = keys.sort((a, b) => (counts[b] || 0) - (counts[a] || 0)).slice(0, CAP);
  const out: TossCounts = {};
  for (const k of ordered) out[k] = counts[k]!;
  return out;
}

// Called when a thread is archived. Only counts when it was never opened:
// archiving something you read is filing, not rejecting.
export function recordToss(senderEmail: string, wasUnread: boolean): TossCounts {
  const key = senderEmail.trim().toLowerCase();
  const counts = loadTossed();
  if (!key || !wasUnread) return counts;
  const next = trim({ ...counts, [key]: (counts[key] || 0) + 1 });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function markAsked(senderEmail: string): void {
  const key = senderEmail.trim().toLowerCase();
  const asked = loadAsked();
  if (asked.includes(key)) return;
  try { localStorage.setItem(ASKED, JSON.stringify([...asked, key].slice(-CAP))); } catch { /* private mode */ }
}

// The one sender worth offering about right now, or null. Highest count wins
// so the offer is always about the most obvious case.
export function tossOffer(counts: TossCounts = loadTossed(), asked: string[] = loadAsked()): { sender: string; n: number } | null {
  const seen = new Set(asked);
  let best: { sender: string; n: number } | null = null;
  for (const [sender, n] of Object.entries(counts)) {
    if (seen.has(sender) || n < TOSS_THRESHOLD) continue;
    if (!best || n > best.n) best = { sender, n };
  }
  return best;
}

export function tossLine(sender: string, n: number): string {
  const who = sender.includes("@") ? sender.split("@")[0]!.replace(/[._-]+/g, " ") : sender;
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  return "You’ve archived " + name + " unread " + n + " times. Send them straight to Noise?";
}
