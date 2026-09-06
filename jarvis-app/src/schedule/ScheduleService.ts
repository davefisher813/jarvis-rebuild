import type { Store, Item, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_EVENT, type EventData, type EventItem, type EventRecurrence } from "./types";
import { eventsForDate, dotsForMonth } from "./calendar";
import { planDuplicateIds, supersededPlanEventIds } from "./planDedupe";
import { recordPicks } from "../events/planOutcome";
import { madeBy } from "../shared/provenance";
import { isTravel } from "./leaveBy";

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
    opts: { date: string; start: string; category?: string; end?: string; location?: string; recurrence?: EventRecurrence; until?: string; gcalId?: string; gcalHash?: string; sourceTaskId?: string; sitting?: number; taskIds?: string[]; source?: import("../shared/provenance").Source; gym?: boolean; travelMin?: number; bufferMin?: number; url?: string; notes?: string; attendees?: { email: string; name?: string }[] },
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
    // PLUMB-F-07: what Google said at import time, so a later import can tell
    // its own change from one he made here. Only ever set by the importer.
    if (opts.gcalHash) data.gcalHash = opts.gcalHash;
    if (opts.sourceTaskId) data.sourceTaskId = opts.sourceTaskId;
    // SCHED-F-04 (2026-09-05): which sitting of that task this block is, when
    // Split It made more than one. The dedupe sweep groups on the pair, so a
    // second sitting is no longer read as a duplicate of the first.
    if (opts.sourceTaskId && opts.sitting && opts.sitting > 0) data.sitting = opts.sitting;
    if (opts.taskIds && opts.taskIds.length) data.taskIds = opts.taskIds;
    if (opts.source) data.source = opts.source;
    // SCHED-F-09 (2026-09-05): a copy of a door block is still the door.
    // Splitting one day off a Training Door series used to produce a block
    // that no longer opened the gym, because the copy went through opts and
    // opts had no way to say so. The receipts (trained) stay behind: they
    // belong to the occurrence that earned them.
    if (opts.gym) data.gym = true;
    // UP-CORE-07 (2026-09-05): travel and slack only mean something next to a
    // place, so they are stored only when there is one.
    if (opts.url?.trim()) data.url = opts.url.trim();
    if (opts.notes?.trim()) data.notes = opts.notes.trim();
    if (opts.attendees?.length) data.attendees = opts.attendees;
    if (data.location && isTravel(opts.travelMin)) data.travelMin = opts.travelMin;
    if (data.location && isTravel(opts.bufferMin)) data.bufferMin = opts.bufferMin;
    const id = await this.store.create(this.ownerId, ENTITY_EVENT, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_EVENT, entityId: id });
    return id;
  }

  // SCHED-F-09 (2026-09-05): the one door every Undo-after-delete goes
  // through, the event twin of TasksService.recreateFrom (B1-3). createEvent's
  // opts are a WHITELIST of the fields a person types into the new-event
  // sheet, and every undo path re-created through it by hand, so a restored
  // event came back without its end date, its skipped days, its attached
  // tasks, its Training Door or its Google id: the daily gym block came back
  // as an ordinary block that repeats forever. A snapshot is a whole record
  // and is written back as one. With the deleted row's id it comes back as
  // ITSELF, so a plan draft or a note pointing at it is not orphaned.
  async recreateFrom(e: EventData, id?: string): Promise<string | null> {
    if (!e.title || !e.title.trim() || !e.date || !e.start) return null;
    const data: EventData = { ...e, title: e.title.trim() };
    const newId = await this.store.create(this.ownerId, ENTITY_EVENT, data as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_EVENT, entityId: newId });
    return newId;
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
  // UP-CORE-05 (2026-09-05): movedBy is set only by re-flow, the one thing
  // that re-times a block without being asked. A person dragging their own
  // event through this same door clears the stamp.
  editTime(id: string, start: string, movedBy?: "reflow"): Promise<boolean> {
    return this.patch(id, { start, moved: movedBy ? madeBy(movedBy) : undefined });
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

  // UP-CORE-07 (2026-09-05): how long it takes to get there, and the slack on
  // top. Null clears either. Clearing the PLACE clears both, because minutes
  // to nowhere is a number with nothing behind it.
  async editTravel(id: string, travelMin: number | null, bufferMin: number | null = null): Promise<boolean> {
    return this.patch(id, {
      travelMin: isTravel(travelMin) ? travelMin : undefined,
      bufferMin: isTravel(travelMin) && isTravel(bufferMin) ? bufferMin : undefined,
    });
  }

  async editLocation(id: string, location: string): Promise<boolean> {
    const place = location.trim();
    if (!place) return this.patch(id, { location: undefined, travelMin: undefined, bufferMin: undefined });
    return this.patch(id, { location: place });
  }

  // THE TRAINING DOOR, D4-C. On/off by the athlete's own hand in the event
  // sheet -- the calendar never guesses which block is the gym (the
  // gameCategoryId doctrine). Turning the door off clears its receipts too:
  // stamps belong to the door, not to the event that remains.
  editGymDoor(id: string, gym: boolean): Promise<boolean> {
    return this.patch(id, gym ? { gym: true } : { gym: undefined, trained: undefined });
  }
  // "When you finish, the block stamps itself done with the real minutes."
  // One stamp per occurrence date; a second session the same day overwrites
  // with the newer truth rather than inventing a ledger.
  async stampTrained(id: string, date: string, minutes: number): Promise<boolean> {
    const e = await this.get(id);
    if (!e || !e.gym) return false;
    return this.patch(id, { trained: { ...(e.trained ?? {}), [date]: Math.max(1, Math.round(minutes)) } });
  }

  // PLUMB-F-07 (2026-09-05): the calendar importer's one write path for an
  // event that is already here. Deliberately narrow: only the fields Google
  // owns, plus the record of what Google last said. An import can therefore
  // move a meeting or rename it, and can never touch the category he filed
  // it under, the tasks he attached, or the gym door he marked.
  applyGoogleChange(
    id: string,
    // UP-CORE-10 (2026-09-05): url, notes and attendees ride the same door.
    // The first two are field-by-field like the rest (his edit here wins);
    // attendees are Google's list alone, since nothing in the app writes them.
    patch: Pick<EventData, "title" | "date" | "start" | "end" | "location" | "gcalHash" | "url" | "notes" | "attendees">,
  ): Promise<boolean> {
    return this.patch(id, patch);
  }

  // UP-CORE-10: the meeting link and the notes, by hand. Empty clears either,
  // which is how a dead Zoom link stops being offered as a Join button.
  editMeeting(id: string, patch: { url?: string; notes?: string }): Promise<boolean> {
    return this.patch(id, {
      ...(patch.url !== undefined ? { url: patch.url.trim() || undefined } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
    });
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
    blocks: { taskId: string; text: string; category: string; start: string; end: string; sitting?: number }[],
    source?: import("../shared/provenance").Source,
    // THE ONE EVENT DOOR (audit 2026-08-25). PlanDaySheet used to be the
    // only emitter of plan.picked and plan.duration_committed, while five
    // other routes committed real days through this method in silence, so
    // every pick-position and duration fact was computed on whichever days
    // happened to be hand-planned. Now every commit emits here. `plan` is
    // passed when the blocks are a coherent day plan (ordered picks); a
    // single placement passes nothing and still records its duration.
    plan?: { picks: string[] },
  ): Promise<{ created: string[]; replaced: number }> {
    const existing = eventsForDate(await this.listEvents(), date);
    const superseded = supersededPlanEventIds(existing, blocks.map((b) => ({ taskId: b.taskId, sitting: b.sitting })));
    for (const id of superseded) await this.deleteEvent(id);
    const created: string[] = [];
    for (const b of blocks) {
      const id = await this.createEvent(b.text, {
        date, start: b.start, end: b.end,
        category: b.category || undefined,
        sourceTaskId: b.taskId,
        ...(b.sitting ? { sitting: b.sitting } : {}),
        ...(source ? { source } : {}),
      });
      if (id) created.push(id);
    }
    const toMin = (t: string) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };
    for (const b of blocks) {
      const mins = toMin(b.end) - toMin(b.start);
      if (b.category && mins > 0) {
        this.onEvent({ type: "plan.duration_committed", entityType: "task", entityId: b.taskId, props: { category: b.category, n: mins } });
      }
    }
    if (plan && plan.picks.length > 0) {
      plan.picks.forEach((id, i) => this.onEvent({ type: "plan.picked", entityType: "task", entityId: id, props: { n: i + 1 } }));
      // The outcome resolver's registry rides this door, so an accepted day
      // counts exactly like a hand-built one. Best-effort: it is a
      // localStorage convenience, and a commit must never fail because
      // storage is absent (tests, private mode).
      //
      // SCHED-F-17 (2026-09-05): saveShape used to run here too, on every
      // commit, writing a day-shape memory whose only reader (the P12 offer)
      // left PlanDaySheet in commit 47173c2 on 2026-08-22. A write with no
      // reader is a store that drifts in silence, so it stopped.
      try {
        recordPicks(date, plan.picks);
      } catch { /* the events above are the record */ }
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

  // SCHED-F-17 (2026-09-05): KEPT, with the reason written down. These three
  // are pass-throughs to the Store and the app never calls them: offline is
  // wired at the Store, through data/offlineSync.ts. Their caller is the
  // schedule spec's offline step, which drives the queue through the same
  // service the rest of the spec uses.
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
