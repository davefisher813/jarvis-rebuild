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

// HMN-F-07 (2026-09-05): one flush at a time. Every logger tap kicks an
// unawaited flush, and two taps inside one network round trip (the body
// map, adjusted with a second tap a beat later) started two flushes that
// each snapshotted the same queue: entry 1 saved twice, three rows for two
// taps. A flush that finds one in flight now waits for it and then runs a
// fresh pass of its own (rather than sharing the first's result), so the
// second tap's entry still lands on this pass, and every entry lands once.
// Module-level because the default storage is a fresh wrapper per call;
// the app has exactly one health queue.
let tail: Promise<unknown> = Promise.resolve();

/** Try to persist every pending entry. Whatever fails stays queued, in
 *  order, for the next attempt. Returns how many landed. Mirrors
 *  gym/liveSession.ts flushPending exactly: same shape, same guarantee. */
export function flushPending(
  save: (entry: PendingHealthLog) => Promise<string | null>,
  store: Storage2 = browserStorage(),
): Promise<number> {
  const run = tail.then(() => drain(save, store));
  tail = run.catch(() => undefined);
  return run;
}

async function drain(
  save: (entry: PendingHealthLog) => Promise<string | null>,
  store: Storage2,
): Promise<number> {
  const all = readPending(store);
  if (all.length === 0) return 0;
  let saved = 0;
  for (const entry of all) {
    let id: string | null = null;
    try { id = await save(entry); } catch { id = null; }
    // Remove each landed entry from storage as it lands, instead of writing
    // back the snapshot's leftovers at the end: a tap queued while this
    // flush was in flight is not in the snapshot, and the old write-back
    // dropped it on the floor. Whatever fails stays where it was, in order.
    if (id) { saved++; removeOne(entry, store); }
  }
  return saved;
}

function removeOne(entry: PendingHealthLog, store: Storage2): void {
  const now = readPending(store);
  const key = JSON.stringify(entry);
  const idx = now.findIndex((e) => JSON.stringify(e) === key);
  if (idx < 0) return;
  now.splice(idx, 1);
  writePending(now, store);
}
