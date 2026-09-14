import type { Store, ItemData, Json } from "@core";
import type { EventInput } from "../events";
import {
  ENTITY_HEALTH_CONSENT, ENTITY_LIGHTS_OUT, ENTITY_ATE_BEFORE, ENTITY_TOOK_IT, ENTITY_CALL_IT, ENTITY_POINT_AT_IT,
  ENTITY_MED_REFILL, ENTITY_BAG_CHECK, ENTITY_LOCKER_DOC, ENTITY_TRUSTED_ADULT, ENTITY_AGE_RULE_SHOWN,
  ENTITY_MED_DEF, ENTITY_MEAL, ENTITY_CHECKIN,
  type MedDefData, type MedDefEntry, type MealData, type MealEntry,
  type ConsentGrant, type ConsentGrantsData, type HealthCategoryId,
  type LightsOutData, type LightsOutEntry,
  type AteBeforeData, type AteBeforeEntry,
  type TookItData, type TookItEntry,
  type CallItData, type CallItEntry,
  type PointAtItData, type PointAtItEntry,
  type MedRefillData, type MedRefillEntry,
  type BagItemState, type BagCheckData, type BagCheckEntry,
  type LockerDocKind, type LockerDocData, type LockerDocEntry,
  type TrustedAdultData, type TrustedAdultEntry,
  type AgeRuleShownData, type AgeRuleShownEntry,
  type CheckInData, type CheckInEntry, type CheckInEnergy, type CheckInMood,
  type PointAtItDetail,
} from "./types";
import { defaultGrants, updateGrant } from "./shareLine";
import { queueHealthLog, flushPending, readPending, removeQueued, patchQueued, type Storage2, type PendingHealthLog } from "./offlineQueue";

// Module-level, like offlineQueue's: more than one HealthService can front
// the same store (HealthFlow builds its own when none is handed in).
let grantTail: Promise<unknown> = Promise.resolve();

/** The event kind for a logged entity (Part 3 wave 4, 2026-09-13): the
 *  brief's typed words for a dose, a meal and a bedtime; the entity key for
 *  the rest. Closed vocabulary either way (serverSink gates the shape). */
export function typedKind(entityType: string): string {
  switch (entityType) {
    case ENTITY_TOOK_IT: return "medication_logged";
    case ENTITY_MEAL: return "meal_logged";
    case ENTITY_LIGHTS_OUT: return "bedtime_logged";
    case ENTITY_CHECKIN: return "checkin_logged";
    default: return entityType;
  }
}

// The Store-backed half of the health module. Consent grants and the five
// loggers, following the same shape as GymService and CategoriesService:
// a thin class over Store, keyed by ownerId, emitting through onEvent.
//
// LOGGING IS OFFLINE-FIRST (see offlineQueue.ts): every logXxx method
// queues to localStorage synchronously and returns immediately, then kicks
// an unawaited flush. A caller that wants to know the tap definitely
// reached the server can await flush() itself; the UI never has to.
export class HealthService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  // ---- The Share Line ----

  async getConsent(): Promise<ConsentGrant[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_HEALTH_CONSENT);
    const item = items[0];
    if (!item) return defaultGrants(Date.now());
    return (item.data as unknown as ConsentGrantsData).grants;
  }

  /** Revoke or grant one category. One tap, no negotiation screen: this is
   *  the entire consent-change surface, deliberately with no confirmation
   *  step and no reason field. */
  setGrant(category: HealthCategoryId, granted: boolean): Promise<ConsentGrant[]> {
    // 2026-09-11: one grant write at a time. This is a read-modify-write of
    // the one consent record, so two quick toggles each read the same grants
    // and the second write undid the first. Same chain as offlineQueue's tail.
    const run = grantTail.then(() => this.writeGrant(category, granted));
    grantTail = run.catch(() => undefined);
    return run;
  }

  private async writeGrant(category: HealthCategoryId, granted: boolean): Promise<ConsentGrant[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_HEALTH_CONSENT);
    const current = items[0] ? (items[0].data as unknown as ConsentGrantsData).grants : defaultGrants(Date.now());
    const next = updateGrant(current, category, granted, Date.now());
    const data: ConsentGrantsData = { grants: next };
    if (items[0]) {
      await this.store.update(this.ownerId, items[0].id, data as unknown as ItemData);
      this.onEvent({ type: "entity.updated", entityType: ENTITY_HEALTH_CONSENT, entityId: items[0].id });
    } else {
      const id = await this.store.create(this.ownerId, ENTITY_HEALTH_CONSENT, data as unknown as ItemData);
      this.onEvent({ type: "entity.created", entityType: ENTITY_HEALTH_CONSENT, entityId: id });
    }
    return next;
  }

  // ---- Offline pending queue plumbing, shared by all five loggers ----

  /** The one write path every queued entry eventually lands through. Public
   *  so a caller (or a background sync) can pass it straight to
   *  flushPending without HealthService re-deriving entity types. */
  async saveQueued(entry: PendingHealthLog): Promise<string | null> {
    const id = await this.store.create(this.ownerId, entry.entityType, entry.data as unknown as ItemData);
    // UP-MIND-05 (2026-09-05): this emitted type "action" with a free-form
    // name, which serverSink deliberately refuses to persist, so a year of
    // health logging reached the Brain as nothing at all. health.logged is a
    // real type whose kind is the entity key itself, already shaped like the
    // sink's [a-z_]{1,24} gate, and rowFrom drops every other prop: what was
    // logged never leaves the device, only that something was.
    if (id) {
      this.onEvent({ type: "action", props: { name: "health." + entry.entityType }, entityType: entry.entityType, entityId: id });
      // Part 3 wave 4 (Dave 14a): the three loggers the brief names carry a
      // typed kind; every other shape keeps its entity key. Still a count:
      // nothing about the dose, the meal or the night rides along.
      this.onEvent({ type: "health.logged", entityType: entry.entityType, entityId: id, props: { kind: typedKind(entry.entityType) } });
    }
    return id;
  }

  /** Drain whatever is queued (from this device, since the last flush). */
  flush(storage?: Storage2): Promise<number> {
    return flushPending((e) => this.saveQueued(e), storage);
  }

  private logAndQueue(entityType: string, data: Record<string, Json>, storage?: Storage2): void {
    queueHealthLog({ entityType, data }, storage);
    void this.flush(storage);
  }

  // ---- Lights Out ----

  logLightsOut(at: number = Date.now(), storage?: Storage2): LightsOutData {
    const data: LightsOutData = { category: "sleep", at };
    this.logAndQueue(ENTITY_LIGHTS_OUT, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listLightsOut(storage?: Storage2): Promise<(LightsOutEntry & { pending?: boolean })[]> {
    return this.listMerged<LightsOutData>(ENTITY_LIGHTS_OUT, storage, (a, b) => a.at - b.at);
  }

  /** Health Push D (H-41): Edit Time on the last bedtime. Writes the clock
   *  and nothing else; only a row that has landed on the store has an id. */
  async updateLightsOut(id: string, at: number): Promise<void> {
    const data: LightsOutData = { category: "sleep", at };
    await this.store.update(this.ownerId, id, data as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_LIGHTS_OUT, entityId: id });
  }

  removeLightsOut(at: number, storage?: Storage2): Promise<boolean> {
    return this.removeLogged(ENTITY_LIGHTS_OUT, at, storage);
  }

  // ---- Ate Before ----

  logAteBefore(input: { eventId?: string; eventTitle?: string; date: string; ate: boolean }, at: number = Date.now(), storage?: Storage2): AteBeforeData {
    const data: AteBeforeData = { category: "fuel", ...input, at };
    this.logAndQueue(ENTITY_ATE_BEFORE, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listAteBefore(storage?: Storage2): Promise<AteBeforeEntry[]> {
    return this.listMerged<AteBeforeData>(ENTITY_ATE_BEFORE, storage, (a, b) => a.date.localeCompare(b.date));
  }

  // ---- Took It ----

  logTookIt(at: number = Date.now(), storage?: Storage2, med?: { medId?: string; amount?: string }): TookItData {
    // Health Push D (H-38): the med and the amount as typed, when the tap
    // named one. Keys are dropped rather than written undefined (UP-ATH-07).
    const data: TookItData = {
      category: "medication", at,
      ...(med?.medId ? { medId: med.medId } : {}),
      ...(med?.amount ? { amount: med.amount } : {}),
    };
    this.logAndQueue(ENTITY_TOOK_IT, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listTookIt(storage?: Storage2): Promise<(TookItEntry & { pending?: boolean })[]> {
    return this.listMerged<TookItData>(ENTITY_TOOK_IT, storage, (a, b) => a.at - b.at);
  }

  removeTookIt(at: number, storage?: Storage2): Promise<boolean> {
    return this.removeLogged(ENTITY_TOOK_IT, at, storage);
  }

  // ---- Medications by name (Health Push D, H-38) ----
  //
  // Configuration, not a log: a med is added, edited and removed like a
  // metric definition, straight on the store. The doses stay in the offline
  // queue above; a med def is made once, on a screen, with signal or a retry.

  async listMedDefs(): Promise<MedDefEntry[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_MED_DEF);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as MedDefData }))
      .sort((a, b) => a.data.order - b.data.order || a.data.at - b.data.at);
  }

  async addMedDef(input: { name: string; amount?: string }, at: number = Date.now()): Promise<MedDefEntry> {
    const existing = await this.listMedDefs();
    const data: MedDefData = {
      category: "medication", name: input.name.trim(),
      ...(input.amount?.trim() ? { amount: input.amount.trim() } : {}),
      order: existing.length, at,
    };
    const id = await this.store.create(this.ownerId, ENTITY_MED_DEF, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MED_DEF, entityId: id });
    this.onEvent({ type: "health.logged", entityType: ENTITY_MED_DEF, entityId: id, props: { kind: "med_def" } });
    return { id, data };
  }

  async updateMedDef(id: string, input: { name: string; amount?: string }): Promise<void> {
    const current = (await this.listMedDefs()).find((m) => m.id === id);
    if (!current) return;
    const data: MedDefData = {
      category: "medication", name: input.name.trim(),
      ...(input.amount?.trim() ? { amount: input.amount.trim() } : {}),
      order: current.data.order, at: current.data.at,
    };
    await this.store.update(this.ownerId, id, data as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_MED_DEF, entityId: id });
  }

  async removeMedDef(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_MED_DEF, entityId: id });
  }

  // ---- Meal (Health Push D, H-42) ----

  logMeal(text: string, at: number = Date.now(), storage?: Storage2): MealData {
    const data: MealData = { category: "fuel", at, text: text.trim() };
    this.logAndQueue(ENTITY_MEAL, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listMeal(storage?: Storage2): Promise<(MealEntry & { pending?: boolean })[]> {
    return this.listMerged<MealData>(ENTITY_MEAL, storage, (a, b) => a.at - b.at);
  }

  removeMeal(at: number, storage?: Storage2): Promise<boolean> {
    return this.removeLogged(ENTITY_MEAL, at, storage);
  }

  // ---- Check In (2026-09-14) ----

  logCheckIn(d: { energy?: CheckInEnergy; mood?: CheckInMood; note?: string }, at: number = Date.now(), storage?: Storage2): CheckInData {
    const data: CheckInData = {
      category: "body", at,
      ...(d.energy ? { energy: d.energy } : {}),
      ...(d.mood ? { mood: d.mood } : {}),
      ...(d.note?.trim() ? { note: d.note.trim() } : {}),
    };
    this.logAndQueue(ENTITY_CHECKIN, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listCheckIn(storage?: Storage2): Promise<(CheckInEntry & { pending?: boolean })[]> {
    return this.listMerged<CheckInData>(ENTITY_CHECKIN, storage, (a, b) => a.at - b.at);
  }

  removeCheckIn(at: number, storage?: Storage2): Promise<boolean> {
    return this.removeLogged(ENTITY_CHECKIN, at, storage);
  }

  // UNDO A TAP (Health Push D). A logged entry is identified by the moment
  // it was logged, because that is the one thing both halves of listMerged
  // agree on: a pending row's "pending-N" id is this class's own invention.
  // The entry leaves the queue first, then this waits for any flush in
  // flight (the tap's own is usually still running), then deletes the row if
  // it landed. Either way the tap is gone once this resolves.
  private async removeLogged(entityType: string, at: number, storage?: Storage2): Promise<boolean> {
    const queued = removeQueued((e) => e.entityType === entityType && e.data.at === at, storage);
    await this.flush(storage).catch(() => 0);
    const items = await this.store.listForUser(this.ownerId, entityType);
    const hit = items.find((i) => (i.data as unknown as { at?: number }).at === at);
    if (hit) {
      await this.store.delete(this.ownerId, hit.id);
      this.onEvent({ type: "entity.deleted", entityType, entityId: hit.id });
      return true;
    }
    return queued > 0;
  }

  // ---- Call It ----

  logCallIt(input: { eventId?: string; durationMin?: number; rpe: number }, at: number = Date.now(), storage?: Storage2): CallItData {
    const rpe = Math.max(0, Math.min(10, Math.round(input.rpe)));
    const data: CallItData = { category: "load", ...input, rpe, at };
    this.logAndQueue(ENTITY_CALL_IT, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listCallIt(storage?: Storage2): Promise<CallItEntry[]> {
    return this.listMerged<CallItData>(ENTITY_CALL_IT, storage, (a, b) => a.at - b.at);
  }

  // ---- Point at It ----

  logPointAtIt(input: { x: number; y: number; side: "front" | "back"; region?: string }, at: number = Date.now(), storage?: Storage2): PointAtItData {
    const { region, ...rest } = input;
    const data: PointAtItData = { category: "body", ...rest, at, ...(region ? { region } : {}) };
    this.logAndQueue(ENTITY_POINT_AT_IT, data as unknown as Record<string, Json>, storage);
    return data;
  }

  /** 2026-09-14: the details typed after the tap (how it feels, how much, a
   *  note), onto the tap they belong to. A tap still in the queue is patched
   *  there; one that landed is updated on the Store. Keys are dropped, never
   *  written undefined. */
  async updatePointAtIt(at: number, detail: PointAtItDetail, storage?: Storage2): Promise<boolean> {
    const patch: Record<string, Json> = {
      ...(detail.feel ? { feel: detail.feel } : {}),
      ...(detail.level ? { level: detail.level } : {}),
      ...(detail.note?.trim() ? { note: detail.note.trim() } : {}),
    };
    if (Object.keys(patch).length === 0) return false;
    if (patchQueued((e) => e.entityType === ENTITY_POINT_AT_IT && e.data.at === at, patch, storage) > 0) return true;
    const items = await this.store.listForUser(this.ownerId, ENTITY_POINT_AT_IT);
    const hit = items.find((it) => (it.data as unknown as PointAtItData).at === at);
    if (!hit) return false;
    await this.store.update(this.ownerId, hit.id, { ...(hit.data as unknown as Record<string, Json>), ...patch } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_POINT_AT_IT, entityId: hit.id });
    return true;
  }

  async listPointAtIt(storage?: Storage2): Promise<PointAtItEntry[]> {
    return this.listMerged<PointAtItData>(ENTITY_POINT_AT_IT, storage, (a, b) => a.at - b.at);
  }

  // ---- Refill Runway ----

  logMedRefill(input: { filledAt: number; dosesInFill: number }, at: number = Date.now(), storage?: Storage2): MedRefillData {
    const dosesInFill = Math.max(1, Math.round(input.dosesInFill));
    const data: MedRefillData = { category: "logistics", filledAt: input.filledAt, dosesInFill, at };
    this.logAndQueue(ENTITY_MED_REFILL, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listMedRefill(storage?: Storage2): Promise<MedRefillEntry[]> {
    return this.listMerged<MedRefillData>(ENTITY_MED_REFILL, storage, (a, b) => a.filledAt - b.filledAt);
  }

  removeMedRefill(at: number, storage?: Storage2): Promise<boolean> {
    return this.removeLogged(ENTITY_MED_REFILL, at, storage);
  }

  // ---- The Bag (Water With You is a row inside it) ----
  //
  // Each tap logs the checklist's FULL state at that moment (log an event,
  // not a state, same as every other write in this file); the screen reads
  // the most recent entry for the event via bag.ts's latestBagCheck.
  logBagCheck(input: { eventId: string; eventTitle?: string; date: string; items: BagItemState[] }, at: number = Date.now(), storage?: Storage2): BagCheckData {
    const data: BagCheckData = { category: "logistics", ...input, at };
    this.logAndQueue(ENTITY_BAG_CHECK, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listBagCheck(storage?: Storage2): Promise<BagCheckEntry[]> {
    return this.listMerged<BagCheckData>(ENTITY_BAG_CHECK, storage, (a, b) => a.at - b.at);
  }

  // ---- The Locker ----

  logLockerDoc(input: { kind: LockerDocKind; label: string; expiresAt?: string; fileName?: string; fileData?: string }, at: number = Date.now(), storage?: Storage2): LockerDocData {
    const data: LockerDocData = { category: "logistics", ...input, at };
    this.logAndQueue(ENTITY_LOCKER_DOC, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listLockerDoc(storage?: Storage2): Promise<LockerDocEntry[]> {
    return this.listMerged<LockerDocData>(ENTITY_LOCKER_DOC, storage, (a, b) => a.at - b.at);
  }

  async removeLockerDoc(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_LOCKER_DOC, entityId: id });
  }

  // ---- Say It to Someone ----
  //
  // One standing record, upserted like the Share Line's grants, not an
  // append-only log: there is exactly one current trusted adult, and
  // changing it is a preference change, not a new fact about the world.
  async getTrustedAdult(): Promise<TrustedAdultEntry | null> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_TRUSTED_ADULT);
    const item = items[0];
    return item ? { id: item.id, data: item.data as unknown as TrustedAdultData } : null;
  }

  async setTrustedAdult(name: string, phone: string, personId?: string): Promise<TrustedAdultData> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_TRUSTED_ADULT);
    // UP-ATH-07 (2026-09-06): personId only when there is one. Clearing a
    // field writes null, never undefined, and a hand-typed adult replacing a
    // picked one must not keep the old link, so the key is dropped from the
    // written shape rather than set to undefined.
    const data: TrustedAdultData = { name: name.trim(), phone: phone.trim(), ...(personId ? { personId } : {}), at: Date.now() };
    if (items[0]) {
      await this.store.update(this.ownerId, items[0].id, data as unknown as ItemData);
      this.onEvent({ type: "entity.updated", entityType: ENTITY_TRUSTED_ADULT, entityId: items[0].id });
    } else {
      const id = await this.store.create(this.ownerId, ENTITY_TRUSTED_ADULT, data as unknown as ItemData);
      this.onEvent({ type: "entity.created", entityType: ENTITY_TRUSTED_ADULT, entityId: id });
    }
    return data;
  }

  // ---- The Age Rule's once-per-season gate ----

  async wasAgeRuleShown(season: string): Promise<boolean> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_AGE_RULE_SHOWN);
    return items.some((i) => (i.data as unknown as AgeRuleShownData).season === season);
  }

  async markAgeRuleShown(season: string): Promise<void> {
    if (await this.wasAgeRuleShown(season)) return;
    const data: AgeRuleShownData = { category: "load", season, at: Date.now() };
    const id = await this.store.create(this.ownerId, ENTITY_AGE_RULE_SHOWN, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_AGE_RULE_SHOWN, entityId: id });
  }

  // Reads what has already landed on the Store AND whatever is still
  // sitting in the local pending queue for this entity type, so a history
  // view is honest even before the next flush completes (a set logged with
  // no bars still shows up on the same screen a second later).
  // HMN-F-22 (2026-09-05): the merged rows now say which half they came
  // from. A pending row's id is "pending-N", which is this method's own
  // invention and means nothing to the Store, so removeLockerDoc on one was
  // a delete of an id that does not exist: the row stayed, the receipt said
  // it went. Callers that offer a delete hide it while `pending` is true.
  private async listMerged<D>(entityType: string, storage: Storage2 | undefined, sort: (a: D, b: D) => number): Promise<{ id: string; data: D; pending?: boolean }[]> {
    const items = await this.store.listForUser(this.ownerId, entityType);
    const server = items.map((i) => ({ id: i.id, data: i.data as unknown as D }));
    const pending = readPending(storage)
      .filter((p) => p.entityType === entityType)
      .map((p, i) => ({ id: "pending-" + i, data: p.data as unknown as D, pending: true }));
    return [...server, ...pending].sort((a, b) => sort(a.data, b.data));
  }
}
