// THIS THREAD BELONGS TO THAT PROJECT (N7, Dave 2026-08-20).
//
// He asked for this on the projects page rounds ago: "can't even link it to
// categories or goals seamlessly". A thread attached to a project means the
// project page can show the conversation, and the email carries the project's
// category colour wherever it appears.
//
// Laws:
//   - The link lives on THIS device, keyed by thread id. It is a view, not a
//     mutation: nothing is written to Gmail and nothing is written to the
//     project, so unlinking leaves no trace anywhere.
//   - One home per thread. A thread that belongs to two projects belongs to
//     neither in any useful sense.

const KEY = "jarvis.mail.links.v1";
const CAP = 300;

export type LinkType = "project" | "goal" | "org";

export interface ThreadLink {
  type: LinkType;
  id: string;
  label: string;
  category?: string;
}

export type LinkMap = Record<string, ThreadLink>;

export function loadLinks(storage: Pick<Storage, "getItem"> = localStorage): LinkMap {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: LinkMap = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const l = v as ThreadLink;
      if (l && typeof l.id === "string" && typeof l.label === "string" &&
          (l.type === "project" || l.type === "goal" || l.type === "org")) out[k] = l;
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: LinkMap, storage: Pick<Storage, "setItem">): void {
  const keys = Object.keys(map).slice(-CAP);
  const trimmed: LinkMap = {};
  for (const k of keys) trimmed[k] = map[k]!;
  try { storage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* private mode */ }
}

export function linkThread(
  threadId: string,
  link: ThreadLink | null,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): LinkMap {
  const cur = loadLinks(storage);
  if (link === null) delete cur[threadId];
  else cur[threadId] = link;
  save(cur, storage);
  return { ...cur };
}

// Threads belonging to one project, for the project page to show.
export function threadsFor(map: LinkMap, type: LinkType, id: string): string[] {
  return Object.entries(map).filter(([, l]) => l.type === type && l.id === id).map(([t]) => t);
}
