import { eventLog } from "../events";
import { localDayParts } from "../events/serverSink";

// The Brain's read of the durable event log (Layer 1 -> Layer 2 boundary).
// LAW from the design doc: the log is NEVER bulk-loaded. Reads are windowed
// queries, most recent first, bounded. The client's RLS select-own policy
// (migration 0015) scopes every row to the caller.
//
// Fallback: with no server client (demo mode, offline first paint), the same
// window is read from the LOCAL event log, so derivations degrade to
// this-device evidence instead of silence. Local rows are a subset of server
// truth, never a contradiction of it: both funnels write from the same bus.

export interface WindowRow {
  type: string;
  day: string; // local YYYY-MM-DD
  h: number;
  category: string | null;
  n: number | null;
  flag: boolean | null;
  kind: string | null;
  // The row's entity, when it has one. An id, never text: it is what lets
  // plan.picked and plan.outcome join into pick-position facts, and what
  // names the tasks behind a carried count. Optional so old readers and
  // fakes keep working unchanged.
  entity_id?: string | null;
}

export const WINDOW_DAYS = 30;
const WINDOW_LIMIT = 2000;

// The minimal query surface the read needs; the real SupabaseClient satisfies
// it (same pattern as SinkClient), tests hand in a fake.
export interface WindowClient {
  from(table: string): {
    select(cols: string): {
      gte(col: string, val: string): {
        in(col: string, vals: string[]): {
          order(col: string, opts: { ascending: boolean }): {
            limit(n: number): PromiseLike<{ data: unknown; error: unknown | null }>;
          };
        };
      };
    };
  };
}

const READ_TYPES = [
  "task.completed", "task.pushed", "plan.picked", "plan.outcome",
  "plan.duration_corrected", "plan.duration_committed",
  "strand.created", "strand.corrected", "strand.deleted",
  // Persisted since layer 1, read for the first time by the monthly seal
  // (2026-08-25): days-in-the-app is a seal fact, and it was already durable.
  "app.opened",
  // Read by the monthly report (2026-08-25): the deck metric was promoted to
  // durable exactly so it could be read once a month; reminder ticks are new.
  //
  // S4-Q28 (2026-09-04): entity.deleted used to sit on this list too, with a
  // comment claiming the monthly report read it. It never did: nothing
  // anywhere derives from a WindowRow of that type, so it only crowded the
  // window's row limit with rows nobody consumed. Still persisted to the
  // server (serverSink.ts's write side is untouched, in case a future reader
  // wants "what you let go of"); just no longer pulled into this window.
  "email.deck_sent", "reminder.ticked",
  // The Brain stops starving (handoff item 1, 2026-09-04): the semantic
  // act email now emits, read by the email_window derivation.
  "email.handled",
  // B5 (2026-09-04): review/seal.ts has folded these into "You take the AI's
  // offers" / "Links get skipped" etc. since 2026-08-25, and serverSink.ts
  // has persisted them just as long -- this list was the one place in
  // between that never named them, so the fold always saw zero rows.
  "suggestion.accepted", "suggestion.dismissed",
];

export function windowStartISO(nowMs: number, days = WINDOW_DAYS): string {
  return localDayParts(nowMs - days * 86400000).day;
}

function rowOk(r: unknown): r is WindowRow {
  const o = r as Partial<WindowRow> | null;
  return !!o && typeof o.type === "string" && typeof o.day === "string" && typeof o.h === "number";
}

export async function readWindow(client: WindowClient | null, nowMs: number, days = WINDOW_DAYS): Promise<WindowRow[]> {
  if (client) {
    try {
      const { data, error } = await client
        .from("event_log")
        .select("type,day,h,category,n,flag,kind,entity_id")
        .gte("day", windowStartISO(nowMs, days))
        .in("type", READ_TYPES)
        // Most recent first is half the law, and it is not decoration: the
        // limit truncates, and without an order clause WHICH 2000 rows come
        // back is the server's choice. Newest-first makes the cut mean
        // "the latest 2000", which is the only honest reading of a window.
        .order("at", { ascending: false })
        .limit(WINDOW_LIMIT);
      if (!error && Array.isArray(data)) return (data as unknown[]).filter(rowOk);
    } catch { /* fall through to local */ }
  }
  return localWindow(nowMs, days);
}

// The same window from the local log: map JarvisEvents to WindowRows through
// the exact prop typing the server sink uses, so the two paths cannot drift.
export function localWindow(nowMs: number, days = WINDOW_DAYS): WindowRow[] {
  const cutoff = nowMs - days * 86400000;
  const types = new Set(READ_TYPES);
  return eventLog
    .all()
    .filter((e) => e.ts >= cutoff && types.has(e.type))
    .map((e) => {
      const p = e.props ?? {};
      const { day, h } = localDayParts(e.ts);
      // Same rule as the server sink: an event that names its own local day
      // (plan.outcome carries the plan's day) is dated by it, not by the
      // moment the resolver happened to run. Shape-gated, never free text.
      const ownDay = typeof p.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day) ? p.day : null;
      return {
        type: e.type,
        day: ownDay ?? day,
        h,
        entity_id: e.entityId ?? null,
        category: typeof p.category === "string" ? p.category : null,
        n: typeof p.n === "number" ? p.n : null,
        flag: typeof p.flag === "boolean" ? p.flag : null,
        kind: typeof p.kind === "string" ? p.kind : null,
      };
    });
}
