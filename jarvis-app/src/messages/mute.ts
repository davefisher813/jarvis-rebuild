// Mute a thread.
//
// The group thread you are cc'd on that pings twelve times a day. Muting means
// JARVIS stops surfacing it, however many replies land. The mail is untouched
// in Gmail: this hides it from the status report, it does not delete, archive,
// or alter anything. That distinction is the whole reason muting is safe.

const KEY = "jarvis.mail.muted.v1";
const CAP = 200;

export function loadMuted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): string[] {
  const next = ids.slice(-CAP);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function mute(threadId: string): string[] {
  const all = loadMuted();
  return all.includes(threadId) ? all : save([...all, threadId]);
}

export function unmute(threadId: string): string[] {
  return save(loadMuted().filter((id) => id !== threadId));
}

export function isMuted(threadId: string, muted: string[] = loadMuted()): boolean {
  return muted.includes(threadId);
}

export function dropMuted<T extends { id: string }>(rows: T[], muted: string[]): T[] {
  if (muted.length === 0) return rows;
  const set = new Set(muted);
  return rows.filter((r) => !set.has(r.id));
}
