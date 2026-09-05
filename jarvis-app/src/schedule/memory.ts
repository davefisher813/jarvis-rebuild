import type { EventItem } from "./types";
import { addDays } from "./calendar";

// Memory layer (roadmap v2, Session 3). Pure work-subtraction: everything the
// user has typed once becomes a suggested default. No new surfaces, no new
// entity type: every suggestion is DERIVED from existing event history at
// runtime, so there is nothing to migrate and nothing to go stale in sync.
// Never applied silently; suggestions fill forms or ask via a toast.

export interface TitleSuggestion {
  title: string;
  category: string;
  location?: string;
  start: string; // typical start, HH:MM
  durationMin: number; // typical length
  timesUsed: number;
}

const norm = (s: string) => s.trim().toLowerCase();

function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}

function durationOf(e: EventItem): number {
  return e.data.end ? Math.max(5, toMin(e.data.end) - toMin(e.data.start)) : 60;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 60;
}

// Group history by normalized title, most recent first within each group.
function byTitle(events: EventItem[]): Map<string, EventItem[]> {
  const m = new Map<string, EventItem[]>();
  for (const e of events) {
    const k = norm(e.data.title);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(e);
    m.set(k, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.data.date.localeCompare(a.data.date));
  return m;
}

function toSuggestion(group: EventItem[]): TitleSuggestion {
  const latest = group[0]!;
  return {
    title: latest.data.title,
    category: latest.data.category,
    location: group.find((e) => e.data.location)?.data.location,
    start: latest.data.start,
    durationMin: median(group.map(durationOf)),
    timesUsed: group.length,
  };
}

// While typing a title: past events whose title starts with the typed text (or
// any word of it does), ranked by how often they happened. Picking one fills
// the whole event: title, category, location, time, duration. Repeat events
// offered whole; typed once, never again.
export function suggestTitles(events: EventItem[], typed: string, limit = 3): TitleSuggestion[] {
  const q = norm(typed);
  if (q.length < 2) return [];
  const out: TitleSuggestion[] = [];
  for (const [key, group] of byTitle(events)) {
    if (key === q) continue; // already fully typed: nothing to offer
    const hit = key.startsWith(q) || key.split(/\s+/).some((w) => w.startsWith(q));
    if (hit) out.push(toSuggestion(group));
  }
  return out.sort((a, b) => b.timesUsed - a.timesUsed).slice(0, limit);
}

// Locations typed before, ranked by frequency; same-title uses rank first.
export function suggestLocations(events: EventItem[], title: string, limit = 3): string[] {
  const t = norm(title);
  const freq = new Map<string, { n: number; sameTitle: number }>();
  for (const e of events) {
    const loc = e.data.location?.trim();
    if (!loc) continue;
    const cur = freq.get(loc) ?? { n: 0, sameTitle: 0 };
    cur.n++;
    if (t && norm(e.data.title) === t) cur.sameTitle++;
    freq.set(loc, cur);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1].sameTitle - a[1].sameTitle || b[1].n - a[1].n)
    .slice(0, limit)
    .map(([loc]) => loc);
}

// Generic verbs and connectors carry no category signal on their own: "call
// the plumber" and "call the insurance company" share nothing but the fact
// that somebody called somebody. Left unfiltered, a title built from these
// (send, call, text, back...) racks up stray votes from ANY past task that
// happens to share one, and whichever category has the most history becomes
// a magnet for words that never meant it (Dave 2026-09-02: three pasted
// tasks with no goal chosen got silently tied to a goal they had nothing to
// do with, because the category under it wins this vote on generic-word
// noise alone). A real content word -- "invoice", "insurance" -- stays a
// signal; only the words too common to mean anything are cut.
const STOPWORDS = new Set([
  "back", "call", "come", "does", "doing", "done", "down", "each", "from",
  "have", "here", "into", "just", "keep", "know", "like", "make", "more",
  "need", "next", "note", "once", "only", "over", "past", "reply", "send",
  "some", "such", "sure", "take", "text", "than", "that", "them", "then",
  "they", "this", "very", "want", "what", "when", "will", "with", "your",
]);

// Category learned from history: exact-title event match first, then the
// category whose past titles (events AND tasks) share a significant word with
// the text. Used to prefill capture when nothing chose a category.
export function suggestCategory(
  events: EventItem[],
  taskHistory: { text: string; category: string }[],
  text: string,
): string | null {
  const q = norm(text);
  if (!q) return null;
  const exact = byTitle(events).get(q);
  if (exact?.[0]?.data.category) return exact[0].data.category;
  const words = new Set(q.split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
  if (words.size === 0) return null;
  const votes = new Map<string, number>();
  const vote = (title: string, cat: string) => {
    if (!cat) return;
    for (const w of norm(title).split(/\s+/)) {
      if (words.has(w)) votes.set(cat, (votes.get(cat) ?? 0) + 1);
    }
  };
  for (const e of events) vote(e.data.title, e.data.category);
  for (const t of taskHistory) vote(t.text, t.category);
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

export interface RepeatCandidate {
  title: string;
  weekday: number; // 0-6, of the run
  count: number; // consecutive weeks including the new one
}

// SCHED-F-07 (2026-09-05): this used to subtract n * 7 * 86,400,000ms from
// local midnight and read the date back through toISOString(), which is the
// UTC day. East of Greenwich local midnight is still yesterday in UTC, so
// every comparison date was off by one, never matched the stored local
// dates, and "third Tuesday running, repeat weekly?" never fired in Berlin,
// Kolkata or Auckland. addDays steps with setDate and formats locally.
function weeksBack(date: string, n: number): string {
  return addDays(date, -7 * n);
}

// "Three Tuesdays in a row -> make it repeating?" After saving a non-recurring
// event, detect the same title on the same weekday for >= `need` consecutive
// weeks (all non-recurring: an existing series never re-asks). The app ASKS via
// a toast; it never silently converts.
export function repeatCandidate(
  events: EventItem[],
  saved: { title: string; date: string; recurrence?: string },
  need = 3,
): RepeatCandidate | null {
  if (saved.recurrence && saved.recurrence !== "none") return null;
  const t = norm(saved.title);
  if (!t) return null;
  const dates = new Set(
    events
      .filter((e) => norm(e.data.title) === t && (!e.data.recurrence || e.data.recurrence === "none"))
      .map((e) => e.data.date),
  );
  dates.add(saved.date);
  let count = 1;
  while (dates.has(weeksBack(saved.date, count))) count++;
  if (count < need) return null;
  return { title: saved.title, weekday: new Date(saved.date + "T00:00:00").getDay(), count };
}
