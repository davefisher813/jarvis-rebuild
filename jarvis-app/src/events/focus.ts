import { bus } from "./index";

// FOCUS BLOCKS FEED THE LOG (UP-MIND-05, Brain build order 1).
//
// events/types.ts has reserved focus.started and focus.completed since the
// schema was written and nothing ever emitted either one, so the Brain has
// never heard about the one thing this app exists to help with: beginning.
//
// What is honest to emit, and nothing more:
//   - STARTED, on the tap that starts a block right now (Just Fifteen). Not
//     on Set a Start, which schedules a container for later: a row saying
//     focus started at 9:02 because a 4 PM block was planned at 9:02 would
//     be a false fact about the user's day, and this log's whole value is
//     that its rows are true.
//   - COMPLETED, when the task that block was for is completed while the
//     block is still open. That is a real, observable finish. A block that
//     simply runs out is not a completion and is not written as one.
//
// The open blocks live on the device, keyed by task, because a block is a
// this-phone-right-now fact and a stale one from another device would
// produce a completion nobody had.

const KEY = "jarvis.focus.open.v1";
// A block nobody finished stops counting. Long enough for the longest
// container the app offers (45 minutes) plus the overrun that is normal, and
// short enough that yesterday's abandoned block cannot claim today's tick.
const OPEN_MAX_MS = 4 * 3600e3;

export type FocusKind = "fifteen" | "ritual";

interface OpenBlock { kind: FocusKind; minutes: number; at: number }

function read(): Record<string, OpenBlock> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    return typeof o === "object" && o !== null && !Array.isArray(o) ? (o as Record<string, OpenBlock>) : {};
  } catch {
    return {};
  }
}

function write(v: Record<string, OpenBlock>): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: the block just does not log */ }
}

/** A focus block began, now, on this tap. */
export function focusStarted(taskId: string, minutes: number, kind: FocusKind, now = Date.now()): void {
  const open = read();
  open[taskId] = { kind, minutes, at: now };
  for (const [id, b] of Object.entries(open)) if (now - b.at > OPEN_MAX_MS) delete open[id];
  write(open);
  bus.emit({ type: "focus.started", entityType: "task", entityId: taskId, props: { kind, n: minutes } });
}

/** The task a block was for got finished. Silent when there was no block:
 *  most completions happen outside one, and that is the normal case. */
export function focusFinished(taskId: string, now = Date.now()): void {
  const open = read();
  const b = open[taskId];
  if (!b) return;
  delete open[taskId];
  write(open);
  if (now - b.at > OPEN_MAX_MS) return;
  bus.emit({
    type: "focus.completed",
    entityType: "task",
    entityId: taskId,
    props: { kind: b.kind, n: Math.round((now - b.at) / 60000) },
  });
}

// Armed once, from the shell. Listening on the bus rather than asking every
// completion path in the app to remember: there are several, and the one
// that forgot would be the one that mattered.
let armed = false;
export function armFocusCompletion(): () => void {
  if (armed) return () => {};
  armed = true;
  const off = bus.subscribe((e) => {
    if (e.type !== "task.completed") return;
    if (typeof e.entityId === "string" && e.entityId) focusFinished(e.entityId, e.ts);
  });
  return () => { armed = false; off(); };
}
