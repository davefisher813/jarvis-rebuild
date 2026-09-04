import type { JarvisEvent } from "./types";

// The durable half of the event pipeline (Brain rebuild, layer 1; migration
// 0015). Subscribes to the same bus as the local log and persists a WHITELIST
// of event types to the event_log table in Supabase.
//
// Design rules, all deliberate (see claude/BRAIN_REBUILD_DESIGN.md):
// - Offline-first: every captured event lands in a local queue first and is
//   flushed opportunistically. A tap on the subway must not lose its event.
// - Typed fields only. rowFrom() maps a known set of props (category, n, flag)
//   into columns and DROPS everything else, so no free text of the user's life
//   can leave the device through this path even by accident.
// - Client-generated uuids + upsert(ignoreDuplicates) make retries safe: a
//   batch that half-landed just lands again as a no-op.
// - entity.updated is NOT persisted: it fires on every edit, carries no
//   derivable meaning on its own, and would dominate the table. Semantic
//   events (task.completed, task.pushed, plan.*) carry the meaning instead.

export interface EventRow {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  at: string; // ISO timestamp
  day: string; // local YYYY-MM-DD at the moment it happened
  h: number; // local hour 0-23
  dow: number; // local day of week 0-6
  category: string | null;
  n: number | null;
  flag: boolean | null;
  kind: string | null; // closed vocab, regex-gated: ai | pattern | first_step | link | proj_step | workout | routine
  src: string; // 'live' | 'import'
}

// Only these types survive to the server. app.opened gives usage rhythm;
// created/deleted give lifecycle; the rest are the semantic acts the Brain's
// launch derivations need. Deliberately local-only: entity.updated (too
// chatty), auth.signed_in/out (privacy, and the server already knows), and
// "action" (its props are free-form names this row shape has no columns for;
// promoting an action to durable means giving it a real EventType first,
// the way plan.duration_corrected was, and email.deck_sent on 2026-08-07).
const PERSISTED: ReadonlySet<string> = new Set([
  "app.opened",
  "entity.created",
  "entity.deleted",
  "task.completed",
  "task.pushed",
  "plan.picked",
  "plan.outcome",
  "suggestion.accepted",
  "suggestion.dismissed",
  "plan.duration_corrected",
  "email.deck_sent",
  "email.handled",
  "plan.duration_committed",
  "strand.created",
  "strand.corrected",
  "strand.deleted",
  "reminder.ticked",
]);

// Storage seam (same pattern as LocalEventLog) so tests run without a browser.
export interface QueueStorage {
  read(): string | null;
  write(value: string): void;
}

const QUEUE_KEY = "jarvis.eventlog.queue.v1";

export const localQueueStorage: QueueStorage = {
  read: () => {
    try {
      return localStorage.getItem(QUEUE_KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(QUEUE_KEY, value);
    } catch {
      /* full or private mode: queueing is best-effort */
    }
  },
};

export function localDayParts(ts: number): { day: string; h: number; dow: number } {
  const d = new Date(ts);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { day, h: d.getHours(), dow: d.getDay() };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // uuid-shaped fallback for exotic webviews; uniqueness is what matters here
  return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
}

// Map a bus event to a table row. Known props map to typed columns; ANY other
// prop is dropped on purpose (the no-free-text rule lives here).
export function rowFrom(e: JarvisEvent): EventRow {
  const { day, h, dow } = localDayParts(e.ts);
  const p = e.props ?? {};
  // An event that names its own local day wins the day column. plan.outcome
  // emits the PLAN's day on purpose (planOutcome.ts): the resolver runs at
  // least a day later, and a receipt dated by the resolver's morning points
  // at the wrong day. Shape-gated like kind: a valid local day or nothing.
  const ownDay = typeof p.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day) ? p.day : null;
  return {
    id: newId(),
    type: e.type,
    entity_type: e.entityType ?? null,
    entity_id: e.entityId ?? null,
    at: new Date(e.ts).toISOString(),
    day: ownDay ?? day,
    h,
    dow,
    category: typeof p.category === "string" ? p.category : null,
    n: typeof p.n === "number" ? p.n : null,
    flag: typeof p.flag === "boolean" ? p.flag : null,
    // kind is a closed vocabulary, never free text; anything unexpected drops.
    kind: typeof p.kind === "string" && /^[a-z_]{1,24}$/.test(p.kind) ? p.kind : null,
    src: "live",
  };
}

// The minimal client surface the sink needs; the real SupabaseClient satisfies
// it, and tests hand in a fake.
export interface SinkClient {
  from(table: string): {
    upsert(
      rows: EventRow[],
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: unknown | null }>;
  };
}

const BATCH = 100;

export class ServerSink {
  private flushing = false;

  constructor(
    private storage: QueueStorage,
    private client: () => SinkClient | null,
    private cap = 2000,
  ) {}

  queue(): EventRow[] {
    const raw = this.storage.read();
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as EventRow[]) : [];
    } catch {
      return [];
    }
  }

  private save(rows: EventRow[]): void {
    // Cap keeps a long-offline device from growing without bound; oldest go
    // first, which understates history rather than breaking the app.
    const trimmed = rows.length > this.cap ? rows.slice(rows.length - this.cap) : rows;
    this.storage.write(JSON.stringify(trimmed));
  }

  /** Bus listener: queue whitelisted events, then try to flush. */
  capture(e: JarvisEvent): void {
    if (!PERSISTED.has(e.type)) return;
    const rows = this.queue();
    rows.push(rowFrom(e));
    this.save(rows);
    void this.flush();
  }

  /** For the Time Sense import: pre-built rows, queued without touching the bus. */
  enqueueRaw(row: EventRow): void {
    const rows = this.queue();
    rows.push(row);
    this.save(rows);
  }

  /**
   * Push queued rows to the server in batches. Safe to call at any time:
   * no client (demo mode) or an error (offline, signed out) leaves the queue
   * intact for the next attempt. Returns rows successfully sent.
   */
  async flush(): Promise<number> {
    if (this.flushing) return 0;
    const c = this.client();
    if (!c) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      for (;;) {
        const rows = this.queue();
        if (rows.length === 0) break;
        const batch = rows.slice(0, BATCH);
        const { error } = await c
          .from("event_log")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: true });
        if (error) break; // keep everything; retry on next event/online/open
        const ids = new Set(batch.map((r) => r.id));
        // Re-read: events appended mid-flight must survive the filter.
        this.save(this.queue().filter((r) => !ids.has(r.id)));
        sent += batch.length;
        if (batch.length < BATCH) break;
      }
    } finally {
      this.flushing = false;
    }
    return sent;
  }
}
