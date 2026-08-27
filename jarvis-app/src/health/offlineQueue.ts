// EVERYTHING LOGS OFFLINE, and not optionally (Part 9, rail 7). Same recon
// as gym/liveSession.ts: the core Store only queues UPDATES when offline,
// creates fail outright. A gym basement, a rural field, a locker room with
// no signal are exactly where these five taps happen, so every one of them
// writes to localStorage FIRST and is never blocked on the network. What is
// queued here flushes to the Store on the next successful write, in order,
// nothing dropped.
//
// One generic pending queue for all five loggers (rather than five separate
// queues) because the shape of "a tap that needs to reach the Store
// eventually" is identical for all of them; only entityType and data differ.

import type { Json } from "@core";

const PENDING_KEY = "jarvis.health.pending.v1";
const PENDING_CAP = 200;

export interface PendingHealthLog {
  entityType: string;
  data: Record<string, Json>;
  queuedAt: number;
}

export interface Storage2 { read(k: string): string | null; write(k: string, v: string): void; remove(k: string): void }

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function readPending(store: Storage2 = browserStorage()): PendingHealthLog[] {
  try {
    const raw = store.read(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingHealthLog[]) : [];
  } catch {
    return [];
  }
}

export function writePending(all: PendingHealthLog[], store: Storage2 = browserStorage()): void {
  store.write(PENDING_KEY, JSON.stringify(all));
}

/** Queue a tap. Synchronous, never touches the network: the tap is "logged"
 *  the instant this returns, which is what makes the three-second rule hold
 *  even with zero bars. */
export function queueHealthLog(entry: Omit<PendingHealthLog, "queuedAt">, store: Storage2 = browserStorage()): void {
  const all = readPending(store);
  all.push({ ...entry, queuedAt: Date.now() });
  writePending(all.slice(-PENDING_CAP), store);
}

/** Try to persist every pending entry. Whatever fails stays queued, in
 *  order, for the next attempt. Returns how many landed. Mirrors
 *  gym/liveSession.ts flushPending exactly: same shape, same guarantee. */
export async function flushPending(
  save: (entry: PendingHealthLog) => Promise<string | null>,
  store: Storage2 = browserStorage(),
): Promise<number> {
  const all = readPending(store);
  if (all.length === 0) return 0;
  const left: PendingHealthLog[] = [];
  let saved = 0;
  for (const entry of all) {
    try {
      const id = await save(entry);
      if (id) saved++;
      else left.push(entry);
    } catch {
      left.push(entry);
    }
  }
  writePending(left, store);
  return saved;
}
