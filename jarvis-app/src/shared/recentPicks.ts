// WHAT YOU PICKED LAST COMES FIRST (the research standard, rule 11, 2026-10-19: recents-first pickers). A picker's list is the current pick, then the
// ones he reached for most recently, then the rest in the app's own order (shared/pickerSort). The memory is this device's, five deep per kind, and
// advisory: a private window just means no recents. Every key is versioned.
const MAX = 5;
const key = (kind: string) => `jarvis.recents.${kind}.v1`;

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The ids picked most recently, newest first. */
export function recentPicks(kind: string): string[] {
  try {
    const raw = store()?.getItem(key(kind));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}

/** Remember a pick: it moves to the front, and only five are kept. */
export function notePick(kind: string, id: string): void {
  if (!id) return;
  try {
    store()?.setItem(key(kind), JSON.stringify([id, ...recentPicks(kind).filter((x) => x !== id)].slice(0, MAX)));
  } catch { /* private mode: no recents, nothing lost */ }
}
