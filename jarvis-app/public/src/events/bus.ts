import { EVENT_SCHEMA_VERSION, type EventInput, type JarvisEvent } from "./types";

type Listener = (e: JarvisEvent) => void;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "e_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// In-memory pub/sub. Components emit; sinks (the local log now, a server sink
// later) subscribe and persist. A throwing listener never blocks the others.
export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(input: EventInput): JarvisEvent {
    const event: JarvisEvent = {
      id: newId(),
      ts: Date.now(),
      v: EVENT_SCHEMA_VERSION,
      ...input,
    };
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("event listener error", err);
      }
    }
    return event;
  }
}
