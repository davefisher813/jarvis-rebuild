// Smart Paste support stores (addendum item 1): the Recent Captures strip
// (last 10, newest first) and the exact-text 7-day dedupe. Both are local,
// versioned, and advisory: losing them costs a nicety, never data.

export interface RecentCapture {
  id: string;
  kind: "task" | "event" | "note";
  title: string;
  ts: number;
}

const RECENT_KEY = "jarvis.captures.v1";
const DEDUPE_KEY = "jarvis.paste.dedupe.v1";
const RECENT_MAX = 10;
const DEDUPE_WINDOW_MS = 7 * 86400000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readRecentCaptures(): RecentCapture[] {
  const s = storage();
  if (!s) return [];
  try {
    const arr = JSON.parse(s.getItem(RECENT_KEY) || "[]") as RecentCapture[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordCapture(c: RecentCapture): void {
  const s = storage();
  if (!s) return;
  try {
    const next = [c, ...readRecentCaptures().filter((r) => r.id !== c.id)].slice(0, RECENT_MAX);
    s.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* the strip is a nicety */ }
}

export function dropCapture(id: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RECENT_KEY, JSON.stringify(readRecentCaptures().filter((r) => r.id !== id)));
  } catch { /* the strip is a nicety */ }
}

// djb2 of the exact paste text: same text, same hash.
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

type DedupeShape = Record<string, number>;

// Was this EXACT text pasted within the last 7 days? Returns the age in ms
// when it was, null when it is fresh. Never blocks by itself: the caller
// shows the fact and offers Save Anyway.
export function pasteSeenAge(text: string, now: () => number = Date.now): number | null {
  const s = storage();
  if (!s) return null;
  try {
    const map = JSON.parse(s.getItem(DEDUPE_KEY) || "{}") as DedupeShape;
    const at = map[hash(text.trim())];
    if (typeof at === "number" && now() - at < DEDUPE_WINDOW_MS) return now() - at;
    return null;
  } catch {
    return null;
  }
}

export function markPasteSeen(text: string, now: () => number = Date.now): void {
  const s = storage();
  if (!s) return;
  try {
    const map = JSON.parse(s.getItem(DEDUPE_KEY) || "{}") as DedupeShape;
    const cutoff = now() - DEDUPE_WINDOW_MS;
    for (const k of Object.keys(map)) if ((map[k] ?? 0) < cutoff) delete map[k];
    map[hash(text.trim())] = now();
    s.setItem(DEDUPE_KEY, JSON.stringify(map));
  } catch { /* dedupe is advisory */ }
}
