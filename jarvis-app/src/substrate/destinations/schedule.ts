import type { Store, ItemData } from "@core";
import { ScheduleService } from "../../schedule/ScheduleService";
import { ENTITY_EVENT, type EventData } from "../../schedule/types";
import { ENTITY_TASK, type TaskData } from "../../notes/types";
import { daysBetween } from "../../schedule/calendar";
import { madeBy } from "../../shared/provenance";
import { isRealDate } from "../../money/ledger/dates";
import { cyrb53 } from "../../messages/briefSource";
import { hashPayload } from "../canonical";
import { CAPTURE_PAYLOAD_VERSION, type EventPayload, type EvidenceField, type Json } from "../contracts";
import { notPrepared, undoGuard, unsupported, type Committed, type DestinationAdapter, type PrepareContext, type PrepareResult, type UndoCheck } from "./types";

// SCHEDULE. An event from a card is the event ScheduleService.createEvent
// makes. The Schedule stores a local date and a wall clock with no zone, the
// way the Google importer and the mail appointment door already do, so a
// timed instant is written in the reader's zone (ctx.zone). A span the model
// cannot draw (more than one day, or across midnight) is not drawn: it stays
// in Email with Open in Gmail, never flattened.
//
// Idempotency rides on the event's clientId, the same durable key the mail
// appointment door uses (migration 0039): a second commit of the same
// appointment, on any device, lands as the same row.

export const SCHEDULE_ADAPTER_VERSION = "schedule-service-2026-10-03";

/** The local date and HH:MM of an instant in a zone, or null for a zone the runtime does not know. */
export function wallClock(instant: string, zone: string): { date: string; time: string } | null {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (!isRealDate(date) || !/^\d{2}$/.test(hour)) return null;
    return { date, time: `${hour}:${get("minute")}` };
  } catch {
    return null;
  }
}

/** One row per appointment per mailbox: the account, the thread and the source's own id, or the slot itself. */
export function captureClientId(ctx: PrepareContext, input: EventPayload, date: string, start: string): string {
  const key = [ctx.account?.trim().toLowerCase() ?? "", ctx.threadId ?? "", input.external_uid ?? `${date}T${start}:${input.title.trim()}`].join("␟");
  return "emailcap_" + cyrb53(key).toString(36) + cyrb53(key, 11).toString(36);
}

type Shape = { date: string; start: string; end?: string };

function shapeOf(input: EventPayload, ctx: PrepareContext): Shape | ReturnType<typeof notPrepared> {
  const t = input.time;
  if (t.all_day) {
    if (!isRealDate(t.start_date) || !isRealDate(t.end_date_exclusive)) return notPrepared(["time"]);
    const days = daysBetween(t.start_date, t.end_date_exclusive);
    if (days < 1) return notPrepared(["time"], "The End Comes Before the Start");
    if (days > 1) return unsupported(["time"], "Multi-Day Events Open in Gmail");
    // The importer's own shape for an all-day event: midnight, no end.
    return { date: t.start_date, start: "00:00" };
  }
  const s = wallClock(t.start_at, ctx.zone);
  const e = wallClock(t.end_at, ctx.zone);
  if (!s || !e) return notPrepared(["time"]);
  if (Date.parse(t.end_at) <= Date.parse(t.start_at)) return notPrepared(["time"], "The End Comes Before the Start");
  if (!wallClock(t.start_at, t.timezone)) return notPrepared(["timezone"]);
  if (e.date !== s.date) return unsupported(["time"], "An Event Across Midnight Opens in Gmail");
  return { date: s.date, start: s.time, end: e.time };
}

function eventData(input: EventPayload, shape: Shape, ctx: PrepareContext): EventData {
  const title = input.title.trim();
  const data: EventData = { title, date: shape.date, start: shape.start, category: "" };
  if (shape.end) data.end = shape.end;
  const location = input.location?.trim();
  if (location) data.location = location;
  (data as EventData & { clientId?: string }).clientId = captureClientId(ctx, input, shape.date, shape.start);
  if (ctx.threadId) data.source = madeBy("email", ctx.threadId, () => Date.parse(ctx.now()));
  return data;
}

export const eventAdapter: DestinationAdapter<EventPayload> = {
  kind: "event",
  destinationKind: ENTITY_EVENT,
  moduleVersion: SCHEDULE_ADAPTER_VERSION,

  async prepare(input, _evidence: EvidenceField[], ctx): Promise<PrepareResult<EventPayload>> {
    const title = input.title.trim();
    if (!title) return notPrepared(["title"]);
    const shape = shapeOf(input, ctx);
    if ("ok" in shape) return shape;
    const normalizedPayload: EventPayload = { ...input, title, location: input.location?.trim() || null };
    const when = shape.end ? `${shape.date} · ${shape.start} to ${shape.end}` : `${shape.date} · All Day`;
    return {
      ok: true,
      kind: "event",
      destinationKind: ENTITY_EVENT,
      data: eventData(normalizedPayload, shape, ctx) as unknown as ItemData,
      normalizedPayload,
      displaySummary: `${title} · ${when}`,
      exactEffect: `Added to Schedule · ${title}`,
      payloadHash: await hashPayload(CAPTURE_PAYLOAD_VERSION, normalizedPayload as unknown as Json),
      moduleVersion: SCHEDULE_ADAPTER_VERSION,
    };
  },

  async commit(store, ownerId, prepared, ctx, id): Promise<Committed> {
    const p = prepared.normalizedPayload;
    const shape = shapeOf(p, ctx);
    if ("ok" in shape) throw new Error("MISSING_DETAILS:" + shape.missing.join(","));
    const data = eventData(p, shape, ctx);
    const schedule = new ScheduleService(store, ownerId);
    const before = id ? null : await schedule.listEvents();
    const made = await schedule.createEvent(data.title, {
      date: data.date, start: data.start,
      ...(data.end ? { end: data.end } : {}),
      ...(data.location ? { location: data.location } : {}),
      ...(data.source ? { source: data.source } : {}),
      clientId: (data as EventData & { clientId?: string }).clientId,
    });
    if (!made) throw new Error("MISSING_DETAILS:title");
    const twin = before?.find((e) => e.id === made);
    const revision = (await store.read(ownerId, made))?.serverTime ?? 0;
    if (twin) return { itemId: made, revision, exactEffect: `Already on Your Schedule · ${data.title}`, duplicateOf: made };
    return { itemId: made, revision, exactEffect: prepared.exactEffect };
  },

  async canUndo(store, ownerId, itemId, recordedRevision): Promise<UndoCheck> {
    const guard = await undoGuard(store, ownerId, itemId, recordedRevision);
    if (!guard.eligible) return guard;
    const tasks = await store.listForUser(ownerId, ENTITY_TASK);
    if (tasks.some((t) => (t.data as unknown as TaskData).eventId === itemId)) {
      return { eligible: false, reason: "Tasks Are Attached to This Event" };
    }
    return { eligible: true, reason: null };
  },
};
