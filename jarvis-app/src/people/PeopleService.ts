import type { Store, ItemData } from "@core";
import { ENTITY_PERSON, type Person, type PersonData, type PersonGroup } from "./types";

// UP-MIND-05 (2026-09-05): widened so reaching out to someone can be logged
// as the act it is. entity.updated on a person says a field changed; it
// cannot say a call was placed.
type Emit = (e: import("../events").EventInput) => void;

export class PeopleService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}

  async list(group?: PersonGroup): Promise<Person[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_PERSON);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as PersonData }))
      // group lives inside JSONB; that predicate stays in memory by design.
      .filter((p) => !group || p.data.group === group)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }

  async get(id: string): Promise<Person | null> {
    const it = await this.store.read(this.ownerId, id);
    return it ? { id: it.id, data: it.data as unknown as PersonData } : null;
  }

  // BRAIN-F-13 (2026-09-05): `id` is for Undo of a delete. Without it the
  // person came back under a new id, so their linked notes (notesLinkedTo
  // reads by id) and any decision attached to them pointed at nothing: the
  // card was back and everything hanging off it was gone. Same shape
  // ProjectsService.create and NotesService.restoreNote already use; only
  // ever pass an id whose row is gone.
  async create(data: PersonData, id?: string): Promise<string | null> {
    if (!data.name || !data.name.trim()) return null;
    const clean: PersonData = { ...data, name: data.name.trim() };
    const newId = await this.store.create(this.ownerId, ENTITY_PERSON, clean as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_PERSON, entityId: newId });
    return newId;
  }

  // Bulk create for contact import: one round trip per batch instead of one
  // per person (758 contacts in seconds, not minutes). Nameless rows dropped;
  // one created-event for the batch keeps listeners from thrashing.
  async createMany(datas: PersonData[]): Promise<string[]> {
    const clean = datas
      .filter((d) => d.name && d.name.trim())
      .map((d) => ({ ...d, name: d.name.trim() }) as unknown as ItemData);
    if (clean.length === 0) return [];
    const ids = await this.store.createMany(this.ownerId, ENTITY_PERSON, clean);
    if (ids.length) this.onEvent({ type: "entity.created", entityType: ENTITY_PERSON, entityId: ids[ids.length - 1]! });
    return ids;
  }

  async update(id: string, patch: Partial<PersonData>): Promise<boolean> {
    const p = await this.get(id);
    if (!p) return false;
    const next = { ...p.data, ...patch };
    if (typeof next.name === "string") next.name = next.name.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_PERSON, entityId: id });
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_PERSON, entityId: id });
  }

  // Call Prep (addendum item 2): tapping Call logs one ATTEMPT, automatically,
  // with undo. Returns the prior value so the undo can restore it exactly
  // (including "never called", which is undefined). Never duration, never
  // outcome; the app knows you dialed and nothing more.
  async logCallAttempt(id: string, at: string = new Date().toISOString()): Promise<{ prior: string | undefined } | null> {
    const p = await this.get(id);
    if (!p) return null;
    const prior = p.data.lastCallAttempt;
    await this.update(id, { lastCallAttempt: at });
    // UP-MIND-05: the person id and the kind, nothing else. Never who they
    // are, never what was said; the app knows a call was placed and the log
    // knows exactly that much.
    this.onEvent({ type: "person.reached", entityType: ENTITY_PERSON, entityId: id, props: { kind: "call" } });
    return { prior };
  }

  // Patches are MERGED into JSONB (a missing key survives a merge), so
  // "never called" restores as empty string, and every reader treats a falsy
  // lastCallAttempt as never-called.
  async restoreCallAttempt(id: string, prior: string | undefined): Promise<void> {
    await this.update(id, { lastCallAttempt: prior ?? "" });
  }
}
