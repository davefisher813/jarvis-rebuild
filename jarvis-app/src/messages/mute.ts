// Mute a thread.
//
// The group thread you are cc'd on that pings twelve times a day. Muting means
// JARVIS stops surfacing it, however many replies land. The mail is untouched
// in Gmail: this hides it from the status report, it does not delete, archive,
// or alter anything. That distinction is the whole reason muting is safe.

export const KEY = "jarvis.mail.muted.v1";
const CAP = 200;

export function loadMuted(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(ids: string[], storage: Pick<Storage, "setItem">): string[] {
  const next = ids.slice(-CAP);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function mute(threadId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  const all = loadMuted(storage);
  return all.includes(threadId) ? all : save([...all, threadId], storage);
}

export function unmute(threadId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  return save(loadMuted(storage).filter((id) => id !== threadId), storage);
}

export function dropMuted<T extends { id: string }>(rows: T[], muted: string[]): T[] {
  if (muted.length === 0) return rows;
  const set = new Set(muted);
  return rows.filter((r) => !set.has(r.id));
}
