import type { JarvisEvent } from "./types";

// Storage seam so the log is testable without a browser and so a server-backed
// sink can replace or accompany this later.
export interface EventStorage {
  read(): string | null;
  write(value: string): void;
}

const STORAGE_KEY = "jarvis.events";

export const localStorageEventStorage: EventStorage = {
  read: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      console.warn("event log write failed (storage full?)", e);
    }
  },
};

// Types the LOCAL log does not keep. entity.updated fires on literally every
// save, carries no meaning on its own, and nothing anywhere reads it back:
// the durable server sink dropped it for exactly those reasons (serverSink.ts:15)
// and the local log kept writing it anyway. It was most of the log's bytes.
//
// PLUMB-F-14 (2026-09-05).
const LOCAL_SKIP: ReadonlySet<string> = new Set(["entity.updated"]);

// Append-only capture. This is the Milestone A start so gaming data accumulates
// from day one. IMPORTANT: localStorage is per-device and bounded (~5MB), so it
// is NOT durable history. Before launch, add a server sink (an owner-scoped,
// append-only events table) that subscribes to the same bus, so history survives
// device loss and syncs across devices. The cap below is only a safety net to
// keep the app from breaking; it is not a substitute for the server sink.
//
// PLUMB-F-14 (2026-09-05): append used to JSON.parse the whole log, push, and
// JSON.stringify it back, synchronously, on every single emit. Measured at the
// cap that is 1.3 MB of JSON and 12 ms per append on desktop node, several
// times worse in a phone WebView, and it landed on the main thread at exactly
// the moment the completion animation is supposed to be smooth. The array is
// held in memory after the first read now and written back on a debounce; the
// app flushes it on the way to the background (see events/index.ts), which is
// the one moment a phone actually loses the process.
export class LocalEventLog {
  // null means "not read from storage yet". Once read, this array IS the log
  // for the life of the page.
  private cache: JarvisEvent[] | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private storage: EventStorage,
    private cap = 10000,
    // How long a burst of events may sit unwritten. Long enough that a
    // completion's cascade of emits costs one write, short enough that an
    // unceremonious kill loses seconds, not a session.
    private flushMs = 2000,
  ) {}

  private load(): JarvisEvent[] {
    if (this.cache) return this.cache;
    const raw = this.storage.read();
    let parsed: JarvisEvent[] = [];
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw);
        if (Array.isArray(value)) parsed = value as JarvisEvent[];
      } catch {
        parsed = [];
      }
    }
    this.cache = parsed;
    return parsed;
  }

  // A copy, as it always was: readers filter and map, and none of them should
  // be able to edit the log by accident.
  all(): JarvisEvent[] {
    return this.load().slice();
  }

  append(e: JarvisEvent): void {
    if (LOCAL_SKIP.has(e.type)) return;
    const events = this.load();
    events.push(e);
    if (events.length > this.cap) events.splice(0, events.length - this.cap);
    this.dirty = true;
    if (this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.flushMs);
      // Never hold the process open for a log write in node (tests, SSR).
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  // Write the in-memory log back now. Safe to call at any time, including
  // when there is nothing to write.
  flush(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.cache) return;
    this.dirty = false;
    this.storage.write(JSON.stringify(this.cache));
  }

  clear(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.cache = [];
    this.dirty = false;
    this.storage.write("[]");
  }
}
