import { eventLog } from "./index";
import { readSamples, type CompletionSample } from "../shared/timeSense";
import type { JarvisEvent } from "./types";

// ONE READER FOR "WHAT GOT DONE" (2026-08-29, from the Brain wiring audit).
//
// A completion has been written to two local stores since Session 6.5: the
// Time Sense sample array (cap 1,000) and the event log (cap 10,000) -- and
// the visible numbers split between them. The category page's Done count,
// its Record, and its "Most gets done on Tuesdays" insight read the sample
// array; the Pushed tile right next to them reads the event log. Two stores,
// different caps, different start dates: the numbers could disagree with
// each other on the same screen, and the offloading research is blunt about
// what one visibly wrong number does to trust in all the rest.
//
// This module is the one door for completion HISTORY reads. The event log is
// the source of truth from the moment it went live; Time Sense samples fill
// in the history from before that moment, since the log's own design doc
// says its first live day is the real epoch and the old samples were never
// bus-imported (deliberately -- see importTimeSenseOnce). Time Sense keeps
// its actual Phase-1 job untouched: hour-of-day energy samples for the
// energy curve, which nothing here changes.
//
// Same completion, both stores: TasksService stamps the sample a breath
// before it emits the event, so around the cutover instant one completion
// could appear in both halves of the union. The slack window drops legacy
// samples that close to the boundary: losing at most one pre-log sample
// beats ever counting a completion twice.
const CUTOVER_SLACK_MS = 60_000;

// Pure core, so the law is testable without storage.
export function unifyCompletions(
  events: JarvisEvent[],
  legacy: CompletionSample[],
): CompletionSample[] {
  const done = events.filter((e) => e.type === "task.completed");
  const first = done[0]; // append-only log: oldest surviving event first
  if (!first) return legacy;
  const cutover = first.ts - CUTOVER_SLACK_MS;
  const old = legacy.filter((s) => s.t < cutover);
  const mapped = done.map((e) => {
    const d = new Date(e.ts);
    const cat = e.props?.["category"];
    const sample: CompletionSample = {
      t: e.ts,
      h: d.getHours(),
      dow: d.getDay(),
      cat: typeof cat === "string" ? cat : "",
    };
    if (typeof e.entityId === "string" && e.entityId) sample.id = e.entityId;
    return sample;
  });
  return [...old, ...mapped];
}

export function completionSamples(): CompletionSample[] {
  return unifyCompletions(eventLog.all(), readSamples());
}
