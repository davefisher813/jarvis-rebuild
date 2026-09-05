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

// Exported so mailSync can mirror this store to the profile (EMAIL-F-19),
// the same way it reaches the other four.
export const KEY = "jarvis.mail.links.v1";
const CAP = 300;

export type LinkType = "project" | "goal" | "org";

export interface ThreadLink {
  type: LinkType;
  id: string;
  label: string;
  category?: string;
  // EMAIL-F-19 (2026-09-05): what the project page shows for the thread. The
  // link used to carry only the PROJECT's name, which is the one thing that
  // page already knows, so the reader had nothing to render. Optional: links
  // made before this render as a plain conversation row, never an invented
  // subject.
  subject?: string;
  from?: string;
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
          (l.type === "project" || l.type === "goal" || l.type === "org")) {
        out[k] = {
          type: l.type, id: l.id, label: l.label,
          ...(typeof l.category === "string" ? { category: l.category } : {}),
          ...(typeof l.subject === "string" ? { subject: l.subject } : {}),
          ...(typeof l.from === "string" ? { from: l.from } : {}),
        };
      }
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

// EMAIL-F-29 (2026-09-05): threadsFor returned bare thread ids and nothing
// called it; linkedThreadsFor below is the one the project page reads,
// because an id with no subject is not a row anybody can render.

// EMAIL-F-19 (2026-09-05): "Project link chips are write-only: nothing ever
// reads a thread's project." The chip has written this map since N7 and the
// only reader was the chip itself. This is what the project page reads: the
// thread id to open, plus whatever the link remembered to show for it.
export interface LinkedThread {
  threadId: string;
  subject?: string;
  from?: string;
}

export function linkedThreadsFor(map: LinkMap, type: LinkType, id: string): LinkedThread[] {
  return Object.entries(map)
    .filter(([, l]) => l.type === type && l.id === id)
    .map(([threadId, l]) => ({
      threadId,
      ...(l.subject ? { subject: l.subject } : {}),
      ...(l.from ? { from: l.from } : {}),
    }));
}
