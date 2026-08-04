import type { ThreadRow } from "../connections/google/map";

// Triage (email 1): one AI pass sorts the inbox into what needs Dave, what is
// worth knowing, and noise — with a one-line gist per thread so junk never has
// to be opened to be dismissed.
//
// Laws:
//   - The parser is tolerant but never inventive: an unparseable reply means
//     NO triage (the UI falls back to a plain list), not a fabricated one.
//   - A thread the model skipped lands in worth_knowing with its snippet as
//     the gist: visible and safe, never silently hidden in noise.
//   - Results are cached per thread keyed by its latest message id, so a
//     refresh costs nothing and only NEW mail is ever sent to the model.
//   - Only from/subject/snippet travel to the model here — never full bodies.

export type Bucket = "needs_you" | "worth_knowing" | "noise";
export interface Triage { bucket: Bucket; gist: string }
export type TriageMap = Record<string, Triage & { lastMsgId: string }>;

const CACHE_KEY = "jarvis.mail.triage.v1";
const CACHE_CAP = 300;
const GIST_MAX = 140;

export const TRIAGE_PROMPT = `You triage an inbox for a busy person with ADHD. For each thread decide:

- "needs_you": the user must act — reply, decide, pay, sign, confirm, or a deadline is coming. A real person waiting on them is needs_you.
- "worth_knowing": real information, no action required (receipts for things already handled, status updates, genuine announcements).
- "noise": promotions, marketing, social-network notifications, newsletters, automated mail nobody replies to.

Also write "gist": ONE plain sentence (under 15 words) saying who wants what and by when. Be concrete: names, amounts, dates. Never scold, never say "you should". If a deadline or amount is in the snippet, it goes in the gist.

Reply with ONLY a JSON array, one object per thread: [{"id":"...","bucket":"needs_you|worth_knowing|noise","gist":"..."}]

THREADS:
`;

export function buildTriageInput(rows: ThreadRow[]): string {
  return TRIAGE_PROMPT + JSON.stringify(
    rows.map((r) => ({ id: r.id, from: r.from, subject: r.subject, snippet: r.snippet.slice(0, 200) })),
  );
}

// Tolerant parse: fences and prose stripped, unknown ids dropped, bad buckets
// coerced to worth_knowing (the honest middle — visible, unalarming). Returns
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
    const { id, bucket, gist } = item as { id?: unknown; bucket?: unknown; gist?: unknown };
    if (typeof id !== "string") continue;
    const row = byId.get(id);
    if (!row) continue;
    const b: Bucket = bucket === "needs_you" || bucket === "noise" ? bucket : "worth_knowing";
    const g = typeof gist === "string" && gist.trim() ? gist.trim().slice(0, GIST_MAX) : row.snippet.slice(0, GIST_MAX);
    out[id] = { bucket: b, gist: g, lastMsgId: row.lastMsgId };
  }
  return Object.keys(out).length ? out : null;
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
// again — whatever it was before, it may need Dave now).
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
      const { bucket, gist, lastMsgId } = v as { bucket?: unknown; gist?: unknown; lastMsgId?: unknown };
      if ((bucket === "needs_you" || bucket === "worth_knowing" || bucket === "noise")
        && typeof gist === "string" && typeof lastMsgId === "string") {
        out[id] = { bucket, gist, lastMsgId };
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
  if (total === 0) return "Inbox is quiet.";
  if (needsYou === 0) return "Nothing needs you. The rest is handled.";
  return needsYou === 1 ? "1 needs you. The rest is handled." : needsYou + " need you. The rest is handled.";
}

// "DoorDash, LinkedIn +3 more" — enough to trust Archive All without opening.
export function noiseLine(noise: ThreadRow[]): string {
  const names = [...new Set(noise.map((r) => r.from))];
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length - 3;
  return extra > 0 ? shown + " +" + extra + " more" : shown;
}
