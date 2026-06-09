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

// Append-only capture. This is the Milestone A start so gaming data accumulates
// from day one. IMPORTANT: localStorage is per-device and bounded (~5MB), so it
// is NOT durable history. Before launch, add a server sink (an owner-scoped,
// append-only events table) that subscribes to the same bus, so history survives
// device loss and syncs across devices. The cap below is only a safety net to
// keep the app from breaking; it is not a substitute for the server sink.
export class LocalEventLog {
  constructor(
    private storage: EventStorage,
    private cap = 10000,
  ) {}

  all(): JarvisEvent[] {
    const raw = this.storage.read();
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as JarvisEvent[]) : [];
    } catch {
      return [];
    }
  }

  append(e: JarvisEvent): void {
    const events = this.all();
    events.push(e);
    const trimmed =
      events.length > this.cap ? events.slice(events.length - this.cap) : events;
    this.storage.write(JSON.stringify(trimmed));
  }

  clear(): void {
    this.storage.write("[]");
  }
}
