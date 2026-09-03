import type { Store, ItemData, Json } from "@core";
import type { EventInput } from "../events";
import {
  ENTITY_HEALTH_CONSENT, ENTITY_LIGHTS_OUT, ENTITY_ATE_BEFORE, ENTITY_TOOK_IT, ENTITY_CALL_IT, ENTITY_POINT_AT_IT,
  ENTITY_MED_REFILL, ENTITY_BAG_CHECK, ENTITY_LOCKER_DOC, ENTITY_TRUSTED_ADULT, ENTITY_AGE_RULE_SHOWN,
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
} from "./types";
import { defaultGrants, updateGrant } from "./shareLine";
import { queueHealthLog, flushPending, readPending, type Storage2, type PendingHealthLog } from "./offlineQueue";

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
  async setGrant(category: HealthCategoryId, granted: boolean): Promise<ConsentGrant[]> {
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
    if (id) this.onEvent({ type: "action", props: { name: "health." + entry.entityType }, entityType: entry.entityType, entityId: id });
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

  async listLightsOut(storage?: Storage2): Promise<LightsOutEntry[]> {
    return this.listMerged<LightsOutData>(ENTITY_LIGHTS_OUT, storage, (a, b) => a.at - b.at);
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

  logTookIt(at: number = Date.now(), storage?: Storage2): TookItData {
    const data: TookItData = { category: "medication", at };
    this.logAndQueue(ENTITY_TOOK_IT, data as unknown as Record<string, Json>, storage);
    return data;
  }

  async listTookIt(storage?: Storage2): Promise<TookItEntry[]> {
    return this.listMerged<TookItData>(ENTITY_TOOK_IT, storage, (a, b) => a.at - b.at);
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

  logPointAtIt(input: { x: number; y: number; side: "front" | "back" }, at: number = Date.now(), storage?: Storage2): PointAtItData {
    const data: PointAtItData = { category: "body", ...input, at };
    this.logAndQueue(ENTITY_POINT_AT_IT, data as unknown as Record<string, Json>, storage);
    return data;
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

  async setTrustedAdult(name: string, phone: string): Promise<TrustedAdultData> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_TRUSTED_ADULT);
    const data: TrustedAdultData = { name: name.trim(), phone: phone.trim(), at: Date.now() };
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
  private async listMerged<D>(entityType: string, storage: Storage2 | undefined, sort: (a: D, b: D) => number): Promise<{ id: string; data: D }[]> {
    const items = await this.store.listForUser(this.ownerId, entityType);
    const server = items.map((i) => ({ id: i.id, data: i.data as unknown as D }));
    const pending = readPending(storage)
      .filter((p) => p.entityType === entityType)
      .map((p, i) => ({ id: "pending-" + i, data: p.data as unknown as D }));
    return [...server, ...pending].sort((a, b) => sort(a.data, b.data));
  }
}
