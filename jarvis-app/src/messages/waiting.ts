import { AUTOMATED_ADDRESS } from "./noReply";
import type { GoogleApi } from "../connections/google/api";
import { mapThread, type ThreadRow } from "../connections/google/map";
import { JARVIS_VOICE } from "../ai/voice";
import { capAfterNumber } from "../shared/casing";
import { shortDate } from "../shared/dateFormat";

// Waiting On (email 3): the loops running the OTHER way, emails the user
// sent that expect a reply and have not gotten one. Derived, never guessed:
// a thread qualifies only if the LAST message is the user's own and enough
// time has passed. If the other person replied, the last message would be
// theirs and the thread drops out on its own.

export interface WaitingRow {
  threadId: string;
  to: string;        // display name of who owes the reply
  toEmail: string;
  subject: string;
  waitingDays: number;
  lastMsgId: string;
}

const MIN_WAIT_DAYS = 2;
// One copy of this rule, in noReply.ts. It lived here AND in autoReply.ts,
// and the thread screen (the one place a person presses Reply) consulted
// neither, which is how reply chips ended up on a no-reply sender.
const AUTOMATED = AUTOMATED_ADDRESS;

export function waitingDaysOf(sentMs: number, now: number): number {
  return Math.floor((now - sentMs) / 86400e3);
}

// S2-7 (2026-09-04): "Waiting On only looks at 15 threads." `in:sent` is
// EVERY sent thread, replied-to or not, ordered by activity -- so a thread
// nobody ever answered is exactly the kind that ages out of the 15 most
// recent first: every reply anyone else sends bumps a live thread back to
// the top and pushes the dead one one slot further from view. A row that
// once qualified is cached here, keyed by thread, so it keeps surfacing
// after it falls out of the search window. `dateMs` is stored, not the
// day-count itself, so the count on screen keeps climbing on every call
// instead of freezing at whatever it read the day it was last actually
// seen.
interface CachedWaitingRow {
  threadId: string;
  to: string;
  toEmail: string;
  subject: string;
  dateMs: number;
  lastMsgId: string;
}
const CACHE_KEY = "jarvis.mail.waiting.cache.v1";
const CACHE_CAP = 200;

export function loadWaitingCache(storage: Pick<Storage, "getItem"> = localStorage): Record<string, CachedWaitingRow> {
  try {
    const raw = JSON.parse(storage.getItem(CACHE_KEY) || "{}") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, CachedWaitingRow> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = v as Partial<CachedWaitingRow> | null;
      if (
        r && typeof r.threadId === "string" && typeof r.to === "string" && typeof r.toEmail === "string" &&
        typeof r.subject === "string" && typeof r.dateMs === "number" && typeof r.lastMsgId === "string"
      ) {
        out[id] = r as CachedWaitingRow;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveWaitingCache(cache: Record<string, CachedWaitingRow>, storage: Pick<Storage, "setItem"> = localStorage): void {
  const entries = Object.entries(cache);
  // Oldest-sent evicted first when over cap, same rule as tracking.ts's
  // store: a cache is for recency, and something that has been unanswered
  // longest without staying in view has already had the least to say.
  const kept = entries.length > CACHE_CAP
    ? entries.sort((a, b) => b[1].dateMs - a[1].dateMs).slice(0, CACHE_CAP)
    : entries;
  try { storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* private mode */ }
}

// The user's own address is who Gmail says we are; rows where the last sender
// is NOT me mean they replied, so I am not waiting.
export async function findWaiting(
  api: Pick<GoogleApi, "searchThreads" | "getProfile">,
  now: number,
  max = 5,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Promise<WaitingRow[]> {
  const me = (await api.getProfile()).emailAddress.toLowerCase();
  const metas = await api.searchThreads("in:sent -in:chats", 15);
  const cache = loadWaitingCache(storage);
  for (const meta of metas) {
    const msgs = meta.messages || [];
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const row = mapThread(meta);
    if (!row) continue;
    // Every case below that used to just `continue` also drops any stale
    // cache entry for this thread: the window just gave a fresh, authoritative
    // answer for it (they replied, it is too new, etc.), which always beats
    // whatever an older cached row still claimed.
    if (row.fromEmail.toLowerCase() !== me) { delete cache[row.id]; continue; } // they replied: not waiting
    const days = waitingDaysOf(row.dateMs, now);
    if (days < MIN_WAIT_DAYS) { delete cache[row.id]; continue; }
    // Who owes the reply = whoever the last message was sent To.
    const toHeader = (last.payload?.headers || []).find((h) => h.name.toLowerCase() === "to")?.value || "";
    const toEmail = (toHeader.match(/<([^>]+)>/)?.[1] || toHeader).trim();
    if (!toEmail || AUTOMATED.test(toEmail)) { delete cache[row.id]; continue; } // machines never owe replies
    if (toEmail.toLowerCase() === me) { delete cache[row.id]; continue; }        // notes to self are not waiting
    const toName = (toHeader.match(/^(.*?)\s*</)?.[1] || toEmail.split("@")[0] || toEmail).trim();
    cache[row.id] = { threadId: row.id, to: toName, toEmail, subject: row.subject, dateMs: row.dateMs, lastMsgId: row.lastMsgId };
  }
  saveWaitingCache(cache, storage);
  const out: WaitingRow[] = Object.values(cache).map((r) => ({
    threadId: r.threadId,
    to: r.to,
    toEmail: r.toEmail,
    subject: r.subject,
    waitingDays: waitingDaysOf(r.dateMs, now),
    lastMsgId: r.lastMsgId,
  }));
  return out.sort((a, b) => b.waitingDays - a.waitingDays).slice(0, max);
}

// "4 days, no reply" or with a real open signal: "Opened Aug 2 · no reply".
// The absence of an open says NOTHING (image blockers read invisibly), so the
// line never claims "not opened".
export function waitingLine(row: WaitingRow, openedISO: string | null): string {
  const wait = row.waitingDays === 1 ? "1 Day · No reply" : capAfterNumber(row.waitingDays + " days · No reply");
  if (!openedISO) return wait;
  const when = shortDate(openedISO);
  return "Opened " + when + " · No reply";
}

// The nudge goes out over the USER'S name, so it inherits JARVIS_VOICE and,
// when the app knows the recipient, the writing voice plus STYLE_SCOPE_RULE
// (Brain Personalization Phase 3). Before this it had neither: every nudge
// read the same whether it was going to a brother-in-law or a sponsor, and
// the model was never told the em dash rule. `voice` is optional so the
// prompt still builds in tests and when context gathering fails.
export function nudgePrompt(row: WaitingRow, voice = ""): { system: string; user: string } {
  return {
    system: [
      JARVIS_VOICE,
      "You draft a SHORT follow-up nudge for an email the user sent that got no reply.",
      "One to three sentences. Warm, zero guilt, zero passive aggression: assume they are busy, make replying easy.",
      "Never mention tracking, opens, or that the user knows anything about whether it was read.",
      "Reply with ONLY the message body, no subject, no signature.",
      voice.trim() ? "\nWrite it as this person would write it:\n" + voice.trim() : "",
    ].filter(Boolean).join("\n"),
    user: "The email was to " + row.to + ", subject: \"" + row.subject + "\", sent " + row.waitingDays + " days ago. Draft the nudge.",
  };
}
