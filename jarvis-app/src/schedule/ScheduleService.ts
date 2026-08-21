import type { Store, Item, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_EVENT, type EventData, type EventItem, type EventRecurrence } from "./types";
import { eventsForDate, dotsForMonth } from "./calendar";
import { planDuplicateIds, supersededPlanEventIds } from "./planDedupe";

// The Schedule feature, backed by the engine Store. Each event is a Store item
// of entity type "event". onEvent feeds the gaming event bus (no-op in tests).
export class ScheduleService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  private async get(id: string): Promise<EventData | null> {
    const item = await this.store.read(this.ownerId, id);
    if (!item || item.entityType !== ENTITY_EVENT) return null;
    return item.data as unknown as EventData;
  }

  async event(id: string): Promise<EventData | null> {
    return this.get(id);
  }

  async createEvent(
    title: string,
    opts: { date: string; start: string; category?: string; end?: string; location?: string; recurrence?: EventRecurrence; until?: string; gcalId?: string; sourceTaskId?: string; taskIds?: string[]; source?: import("../shared/provenance").Source },
  ): Promise<string | null> {
    if (!title || !title.trim() || !opts.date || !opts.start) return null;
    const data: EventData = {
      title: title.trim(),
      date: opts.date,
      start: opts.start,
      category: opts.category ?? "",
    };
    if (opts.end) data.end = opts.end;
    if (opts.recurrence && opts.recurrence !== "none") data.recurrence = opts.recurrence;
    // An end date only means something on a series, and only when it is not
    // before the start; anything else is dropped rather than stored as a lie.
    if (data.recurrence && opts.until && opts.until >= opts.date) data.until = opts.until;
    if (opts.location && opts.location.trim()) data.location = opts.location.trim();
    if (opts.gcalId) data.gcalId = opts.gcalId;
    if (opts.sourceTaskId) data.sourceTaskId = opts.sourceTaskId;
    if (opts.taskIds && opts.taskIds.length) data.taskIds = opts.taskIds;
    if (opts.source) data.source = opts.source;
    const id = await this.store.create(this.ownerId, ENTITY_EVENT, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_EVENT, entityId: id });
    return id;
  }

  private async patch(id: string, patch: Partial<EventData>): Promise<boolean> {
    const e = await this.get(id);
    if (!e) return false;
    await this.store.update(this.ownerId, id, patch as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_EVENT, entityId: id });
    return true;
  }

  editTitle(id: string, title: string): Promise<boolean> {
    if (!title || !title.trim()) return Promise.resolve(false);
    return this.patch(id, { title: title.trim() });
  }
  editTime(id: string, start: string): Promise<boolean> {
    return this.patch(id, { start });
  }
  editEnd(id: string, end: string): Promise<boolean> {
    return this.patch(id, { end: end || undefined });
  }
  editRecurrence(id: string, recurrence: EventRecurrence): Promise<boolean> {
    // Clearing the repeat clears its end date too: an end on a one-off is a
    // dangling fact that would come back the moment it repeated again.
    return this.patch(id, recurrence === "none"
      ? { recurrence: undefined, until: undefined }
      : { recurrence });
  }
  // N3: set or clear the series end. Empty clears it back to forever, and an
  // end before the start is refused rather than stored as a lie.
  async editUntil(id: string, until: string | null): Promise<boolean> {
    const e = await this.get(id);
    if (!e) return false;
    return this.patch(id, { until: until && until >= e.date ? until : undefined });
  }
  // Remove a single occurrence date from a recurring series.
  async addExdate(id: string, date: string): Promise<boolean> {
    const e = await this.get(id);
    if (!e) return false;
    const exdates = Array.from(new Set([...(e.exdates ?? []), date]));
    return this.patch(id, { exdates });
  }
  // Put a skipped occurrence back. Undo for "skip this one" and for the
  // occurrence split that a one-day move performs (2026-08-19).
  async removeExdate(id: string, date: string): Promise<boolean> {
    const e = await this.get(id);
    if (!e) return false;
    const exdates = (e.exdates ?? []).filter((d) => d !== date);
    return this.patch(id, { exdates: exdates.length ? exdates : undefined });
  }
  moveDay(id: string, date: string): Promise<boolean> {
    return this.patch(id, { date });
  }
  editCategory(id: string, category: string): Promise<boolean> {
    return this.patch(id, { category });
  }
  // Attached tasks (Session 4 connections). Stored on the event; die with it.
  editTaskIds(id: string, taskIds: string[]): Promise<boolean> {
    return this.patch(id, { taskIds: taskIds.length ? taskIds : undefined });
  }

  async editLocation(id: string, location: string): Promise<boolean> {
    return this.patch(id, { location: location.trim() });
  }

  async deleteEvent(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_EVENT, entityId: id });
  }

  // THE ONLY WAY A PLAN LANDS ON THE CALENDAR (hotfix 2026-08-21). Every
  // placement pass (Plan My Day, Plan Tomorrow, the Today day-draft card,
  // tap-to-schedule) commits through here, and the commit REPLACES: any prior
  // plan event for the same task on the same day is deleted in the same pass,
  // against a fresh read, never the caller's possibly-stale state. Re-running
  // a plan can therefore move a task's block but never multiply it.
  async commitPlan(
    date: string,
    blocks: { taskId: string; text: string; category: string; start: string; end: string }[],
    source?: import("../shared/provenance").Source,
  ): Promise<{ created: string[]; replaced: number }> {
    const existing = eventsForDate(await this.listEvents(), date);
    const superseded = supersededPlanEventIds(existing, blocks.map((b) => b.taskId));
    for (const id of superseded) await this.deleteEvent(id);
    const created: string[] = [];
    for (const b of blocks) {
      const id = await this.createEvent(b.text, {
        date, start: b.start, end: b.end,
        category: b.category || undefined,
        sourceTaskId: b.taskId,
        ...(source ? { source } : {}),
      });
      if (id) created.push(id);
    }
    return { created, replaced: superseded.length };
  }

  // Self-healing sweep at the read boundary (same pattern as the gcal import
  // sweep and the projects backfill): collapse any (task, day) group holding
  // more than one plan event, first-upcoming wins. Acts only on duplicates
  // visible in one consistent read, so a cold read deletes nothing. Returns
  // how many extra copies were removed.
  async healPlanDuplicates(date: string, nowMin: number | null = null): Promise<number> {
    const ids = planDuplicateIds(eventsForDate(await this.listEvents(), date), nowMin);
    for (const id of ids) await this.deleteEvent(id);
    return ids.length;
  }

  async listEvents(): Promise<EventItem[]> {
    const items: Item[] = await this.store.listForUser(this.ownerId, ENTITY_EVENT);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as EventData }));
  }

  async eventsOn(date: string): Promise<EventItem[]> {
    return eventsForDate(await this.listEvents(), date);
  }
  async daysWithEvents(year: number, month: number): Promise<Record<number, string[]>> {
    return dotsForMonth(await this.listEvents(), year, month);
  }
  async countOn(date: string): Promise<number> {
    return (await this.eventsOn(date)).length;
  }

  goOffline(): void {
    this.store.goOffline();
  }
  reconnect(): Promise<void> {
    return this.store.reconnect();
  }
  queueLen(): number {
    return this.store.queueLen();
  }
}
