import type { Store, Item, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_EVENT, type EventData, type EventItem, type EventRecurrence } from "./types";
import { eventsForDate, dotsForMonth } from "./calendar";

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
    opts: { date: string; start: string; category?: string; end?: string; location?: string; recurrence?: EventRecurrence; gcalId?: string; sourceTaskId?: string },
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
    if (opts.location && opts.location.trim()) data.location = opts.location.trim();
    if (opts.gcalId) data.gcalId = opts.gcalId;
    if (opts.sourceTaskId) data.sourceTaskId = opts.sourceTaskId;
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
    return this.patch(id, { recurrence: recurrence === "none" ? undefined : recurrence });
  }
  // Remove a single occurrence date from a recurring series.
  async addExdate(id: string, date: string): Promise<boolean> {
    const e = await this.get(id);
    if (!e) return false;
    const exdates = Array.from(new Set([...(e.exdates ?? []), date]));
    return this.patch(id, { exdates });
  }
  moveDay(id: string, date: string): Promise<boolean> {
    return this.patch(id, { date });
  }
  editCategory(id: string, category: string): Promise<boolean> {
    return this.patch(id, { category });
  }

  async editLocation(id: string, location: string): Promise<boolean> {
    return this.patch(id, { location: location.trim() });
  }

  async deleteEvent(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_EVENT, entityId: id });
  }

  async listEvents(): Promise<EventItem[]> {
    const items: Item[] = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_EVENT)
      .map((i) => ({ id: i.id, data: i.data as unknown as EventData }));
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
