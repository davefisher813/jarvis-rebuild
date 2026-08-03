import { EventBus } from "./bus";
import { LocalEventLog, localStorageEventStorage } from "./log";
import { ServerSink, localQueueStorage } from "./serverSink";
import type { EventInput } from "./types";

// One bus for the app. Two sinks subscribe:
// - the local log captures everything (gaming source, per-device), and
// - the server sink (Session 6.5) durably persists a whitelist of semantic
//   events to Supabase, which is what the Brain's derivations read.
export const bus = new EventBus();
export const eventLog = new LocalEventLog(localStorageEventStorage);

// The auth client import is lazy (a function) so this module stays loadable in
// tests and demo mode; with no client the sink just queues locally.
export const serverSink = new ServerSink(localQueueStorage, () => {
  try {
    // Resolved at call time to avoid a cycle at module init.
    return sinkClient;
  } catch {
    return null;
  }
});
let sinkClient: import("./serverSink").SinkClient | null = null;
export function connectEventSink(client: import("./serverSink").SinkClient | null): void {
  sinkClient = client;
  if (client) void serverSink.flush();
}

bus.subscribe((e) => eventLog.append(e));
bus.subscribe((e) => serverSink.capture(e));

// Flush when connectivity returns; guarded for non-browser tests.
try {
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void serverSink.flush());
  }
} catch {
  /* non-browser */
}

// App-wide emit helper.
export function emit(input: EventInput) {
  return bus.emit(input);
}

export * from "./types";
export { EventBus } from "./bus";
export { LocalEventLog, localStorageEventStorage } from "./log";
export type { EventStorage } from "./log";
