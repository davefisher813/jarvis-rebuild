import { EventBus } from "./bus";
import { LocalEventLog, localStorageEventStorage } from "./log";
import type { EventInput } from "./types";

// One bus for the app. The local log subscribes and captures everything.
// A server sink (durable, cross-device) gets added before launch by simply
// subscribing to this same bus.
export const bus = new EventBus();
export const eventLog = new LocalEventLog(localStorageEventStorage);

bus.subscribe((e) => eventLog.append(e));

// App-wide emit helper.
export function emit(input: EventInput) {
  return bus.emit(input);
}

export * from "./types";
export { EventBus } from "./bus";
export { LocalEventLog, localStorageEventStorage } from "./log";
export type { EventStorage } from "./log";
