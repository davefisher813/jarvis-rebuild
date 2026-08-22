import type { ThreadRow } from "../connections/google/map";
import { noDashes } from "../ai/suggestions";
import { capAfterNumber } from "../shared/casing";

// Triage (email 1): one AI pass sorts the inbox into what needs Dave, what is
// worth knowing, and noise, with a one-line gist per thread so junk never has
// to be opened to be dismissed.
//
// Laws:
//   - The parser is tolerant but never inventive: an unparseable reply means
//     NO triage (the UI falls back to a plain list), not a fabricated one.
//   - A thread the model skipped lands in worth_knowing with its snippet as
//     the gist: visible and safe, never silently hidden in noise.
//   - Results are cached per thread keyed by its latest message id, so a
//     refresh costs nothing and only NEW mail is ever sent to the model.
//   - Only from/subject/snippet travel to the model here, never full bodies.

export type Bucket = "needs_you" | "worth_knowing" | "noise";
// "by" is the answer-by the SENDER stated, never one we invented: "today",
// "friday", "aug 14", or "" when nobody named a time. Fake urgency is the
// thing this feature exists to remove, so an absent deadline stays absent.
export interface Triage { bucket: Bucket; gist: string; by?: string }
export type TriageMap = Record<string, Triage & { lastMsgId: string }>;

// v2: the cached shape gained "by" (the sender's stated deadline). Entries
// written by v1 have no deadline and, because the delta only re-triages a
// thread when a NEW message arrives, they would never get one. Bumping the key
// forces one re-sort, after which deadlines appear on mail that is already in
// the inbox. Any schema change here MUST bump this.
const CACHE_KEY = "jarvis.mail.triage.v2";
const CACHE_CAP = 300;
const GIST_MAX = 140;

export const TRIAGE_PROMPT = `You triage an inbox for a busy person with ADHD. For each thread decide:

- "needs_you": the user must act, reply, decide, pay, sign, confirm, or a deadline is coming. A real person waiting on them is needs_you.
- "worth_knowing": real information, no action required (receipts for things already handled, status updates, genuine announcements).
- "noise": promotions, marketing, social-network notifications, newsletters, automated mail nobody replies to.

Also write "gist": ONE plain sentence (under 15 words) saying who wants what and by when. Be concrete: names, amounts, dates. Never scold, never say "you should". If a deadline or amount is in the snippet, it goes in the gist.

Also write "by": the answer-by the SENDER actually stated, copied in their words and under 20 characters ("today", "Friday", "Aug 14", "end of month"). If the sender did not name a time, use "". NEVER invent a deadline and never guess one from tone.

Reply with ONLY a JSON array, one object per thread: [{"id":"...","bucket":"needs_you|worth_knowing|noise","gist":"...","by":"..."}]

THREADS:
`;

// Structured-output schema (item 12). The tool input must be an object, so
// the array rides under "threads"; parseTriage already hunts for the first
// "[" and last "]" in the reply, which lands exactly on that array, so the
// tolerant parser keeps working unchanged on the guaranteed shape.
export const TRIAGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          bucket: { type: "string", enum: ["needs_you", "worth_knowing", "noise"] },
          gist: { type: "string", description: "one sentence, under 15 words, who wants what by when" },
          by: { type: "string", description: "sender's stated deadline in their words, or empty" },
        },
        required: ["id", "bucket", "gist", "by"],
      },
    },
  },
  required: ["threads"],
};

export function buildTriageInput(rows: ThreadRow[]): string {
  return TRIAGE_PROMPT + JSON.stringify(
    rows.map((r) => ({ id: r.id, from: r.from, subject: r.subject, snippet: r.snippet.slice(0, 200) })),
  );
}

// Tolerant parse: fences and prose stripped, unknown ids dropped, bad buckets
// coerced to worth_knowing (the honest middle, visible, unalarming). Returns
// null when there is nothing usable.
export function parseTriage(raw: string, rows: ThreadRow[]): TriageMap | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: TriageMap = {};
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { id, bucket, gist, by } = item as { id?: unknown; bucket?: unknown; gist?: unknown; by?: unknown };
    if (typeof id !== "string") continue;
    const row = byId.get(id);
    if (!row) continue;
    const b: Bucket = bucket === "needs_you" || bucket === "noise" ? bucket : "worth_knowing";
    const g = noDashes(typeof gist === "string" && gist.trim() ? gist.trim().slice(0, GIST_MAX) : row.snippet.slice(0, GIST_MAX));
    const d = typeof by === "string" ? by.trim().slice(0, 20) : "";
    out[id] = { bucket: b, gist: g, lastMsgId: row.lastMsgId, ...(d ? { by: d } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

// A BLANK EMAIL FROM YOURSELF NEVER NEEDS YOU (2026-08-22, from Dave's
// screenshot: "David Fisher emailed with no subject or content" ranked under
// Needs You). The model, given nothing, wrote a gist about the nothing and
// called it urgent. Deterministic guard, applied after triage: your own
// address plus an empty subject plus an empty snippet is a stray tap on
// Send, not a task. It stays visible in Worth Knowing, because deciding a
// user's own mail is garbage is not this app's call to make.
export function selfBlankGuard(map: TriageMap, rows: ThreadRow[], myEmails: string[]): TriageMap {
  const mine = new Set(myEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (mine.size === 0) return map;
  const out = { ...map };
  for (const r of rows) {
    if (!mine.has(r.fromEmail.trim().toLowerCase())) continue;
    if (r.subject.trim() !== "" || r.snippet.trim() !== "") continue;
    const cur = out[r.id];
    if (!cur || cur.bucket !== "needs_you") continue;
    out[r.id] = { ...cur, bucket: "worth_knowing", gist: "A blank note from you" };
  }
  return out;
}

// A skipped thread is surfaced, not hidden: worth_knowing with its snippet.
export function fillSkipped(map: TriageMap, rows: ThreadRow[]): TriageMap {
  const out = { ...map };
  for (const r of rows) {
    if (!out[r.id]) out[r.id] = { bucket: "worth_knowing", gist: r.snippet.slice(0, GIST_MAX), lastMsgId: r.lastMsgId };
  }
  return out;
}

// Threads with no cache entry, or with a NEW latest message (someone wrote
// again, whatever it was before, it may need Dave now).
export function triageDelta(rows: ThreadRow[], cache: TriageMap): ThreadRow[] {
  return rows.filter((r) => !cache[r.id] || cache[r.id]!.lastMsgId !== r.lastMsgId);
}

export function loadTriageCache(storage: Pick<Storage, "getItem"> = localStorage): TriageMap {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: TriageMap = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const { bucket, gist, lastMsgId, by } = v as { bucket?: unknown; gist?: unknown; lastMsgId?: unknown; by?: unknown };
      if ((bucket === "needs_you" || bucket === "worth_knowing" || bucket === "noise")
        && typeof gist === "string" && typeof lastMsgId === "string") {
        out[id] = { bucket, gist, lastMsgId, ...(typeof by === "string" && by ? { by } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Insertion order is preserved by JSON.stringify/parse, so trimming the front
// drops the oldest entries first.
export function saveTriageCache(map: TriageMap, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    const ids = Object.keys(map);
    const keep = ids.length > CACHE_CAP ? ids.slice(ids.length - CACHE_CAP) : ids;
    const out: TriageMap = {};
    for (const id of keep) out[id] = map[id]!;
    storage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or unavailable: triage just re-runs next time */ }
}

// --- Presentation helpers ---

export function splitByBucket(rows: ThreadRow[], map: TriageMap): {
  needsYou: ThreadRow[]; worthKnowing: ThreadRow[]; noise: ThreadRow[];
} {
  const needsYou: ThreadRow[] = [];
  const worthKnowing: ThreadRow[] = [];
  const noise: ThreadRow[] = [];
  for (const r of rows) {
    const b = map[r.id]?.bucket ?? "worth_knowing";
    (b === "needs_you" ? needsYou : b === "noise" ? noise : worthKnowing).push(r);
  }
  return { needsYou, worthKnowing, noise };
}

// The headline the tab lives by: the count that matters, never unread totals.
export function headline(needsYou: number, total: number): string {
  if (total === 0) return "Inbox is quiet";
  if (needsYou === 0) return "Nothing needs you";
  return capAfterNumber(needsYou === 1 ? "1 needs you · Rest handled" : needsYou + " need you · Rest handled");
}

// "DoorDash, LinkedIn +3 more", enough to trust Archive All without opening.
export function noiseLine(noise: ThreadRow[]): string {
  const names = [...new Set(noise.map((r) => r.from))];
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length - 3;
  return extra > 0 ? shown + " +" + extra + " more" : shown;
}

// Ranking for the answer-by the sender stated. Lower sorts first. Anything we
// cannot read stays in the middle: an unparsed phrase must never jump the
// queue, and "no rush" must never outrank a real date.
export function byRank(by: string | undefined, now = new Date()): number {
  const t = (by || "").trim().toLowerCase();
  if (!t) return 500;
  if (/(no rush|whenever|any ?time|when you can)/.test(t)) return 900;
  if (/(asap|urgent|now|today|end of day|eod)/.test(t)) return 0;
  if (/tomorrow/.test(t)) return 1;
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const day = DAYS.findIndex((d) => t.startsWith(d.slice(0, 3)));
  if (day >= 0) {
    const delta = (day - now.getDay() + 7) % 7;
    return delta === 0 ? 7 : delta; // "friday" said ON friday means next friday
  }
  if (/(this week|end of week)/.test(t)) return 5;
  if (/(next week)/.test(t)) return 10;
  if (/(this month|end of month)/.test(t)) return 20;
  const d = new Date(t + " " + now.getFullYear());
  if (!isNaN(d.getTime())) {
    const days = Math.round((d.getTime() - now.getTime()) / 86400000);
    if (days >= -1 && days < 365) return Math.max(0, days);
  }
  return 500;
}

// Needs You in the order the SENDERS need it, not the order it arrived.
// Equal deadlines fall back to newest first, which is the old behaviour.
export function sortByDeadline(rows: ThreadRow[], map: TriageMap, now = new Date()): ThreadRow[] {
  return [...rows].sort((a, b) => {
    const ra = byRank(map[a.id]?.by, now);
    const rb = byRank(map[b.id]?.by, now);
    return ra !== rb ? ra - rb : b.dateMs - a.dateMs;
  });
}

// The Today line. Email stops being a destination: one sentence on the Today
// page says where it stands, and only appears when something actually needs
// him. Silence when the answer is "nothing", a card that says "0 emails need
// you" is still a thing to read.
export function todayEmailLine(needsYou: number, replied: number): string {
  if (needsYou <= 0) return "";
  const who = capAfterNumber(needsYou === 1 ? "1 email needs you" : needsYou + " emails need you");
  if (replied >= needsYou && needsYou > 0) {
    return who + " · " + (needsYou === 1 ? "reply written" : "replies written");
  }
  return who;
}

// Counts straight off the cache, so Today never waits on the network or the
// AI. Cache-only is the point: this line must render instantly or not at all.
export function needsYouCount(map: TriageMap = loadTriageCache()): number {
  return Object.values(map).filter((t) => t.bucket === "needs_you").length;
}
