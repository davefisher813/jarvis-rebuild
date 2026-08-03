import { connectEventSink, emit, serverSink } from "./index";
import { resolvePendingPlans } from "./planOutcome";
import { localDayParts, type EventRow } from "./serverSink";
import { readSamples } from "../shared/timeSense";
import { todayISO } from "../tasks/grouping";

// App-start wiring for the durable event pipeline (Session 6.5). Called once
// from main.tsx. Everything here is best-effort and must never block or break
// boot: the log serves the app, not the other way around.

const IMPORT_FLAG = "jarvis.eventlog.imported.v1";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
}

/**
 * One-time, best-effort backfill of existing Time Sense samples as
 * src='import' rows. Straight into the queue, NOT via the bus, so the local
 * gaming log doesn't get duplicate history. localStorage has misbehaved on
 * device before (unexplained white screen), so samples may be partial; the
 * design doc is explicit that the log's first live day is the real epoch and
 * this import promises nothing.
 */
export function importTimeSenseOnce(): number {
  try {
    if (localStorage.getItem(IMPORT_FLAG)) return 0;
  } catch {
    return 0; // no storage: nothing to import from anyway
  }
  let queued = 0;
  for (const s of readSamples()) {
    const { day, h, dow } = localDayParts(s.t);
    const row: EventRow = {
      id: newId(),
      type: "task.completed",
      entity_type: "task",
      entity_id: s.id ?? null,
      at: new Date(s.t).toISOString(),
      day,
      h,
      dow,
      category: s.cat ?? "",
      n: null,
      flag: null,
      kind: null,
      src: "import",
    };
    serverSink.enqueueRaw(row);
    queued++;
  }
  try {
    localStorage.setItem(IMPORT_FLAG, new Date().toISOString());
  } catch {
    /* if the flag can't persist, ignoreDuplicates would still be defeated by
       new ids; accept the risk as near-zero (storage that can't write the flag
       couldn't have queued rows either) */
  }
  return queued;
}

/** Boot the pipeline: connect the client, backfill once, settle old plans, flush. */
export function startEventPipeline(client: import("./serverSink").SinkClient | null): void {
  try {
    connectEventSink(client);
    importTimeSenseOnce();
    // Yesterday's plan gets scored the first time the app opens on a later day.
    resolvePendingPlans(todayISO(), readSamples(), emit);
    void serverSink.flush();
  } catch (err) {
    console.warn("event pipeline start failed (non-fatal)", err);
  }
}
