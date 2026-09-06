import type { Store, ItemData } from "@core";
import { ENTITY_DECISION, type DecisionRecord, type DecisionRecordData, type DecisionLinkType } from "./types";

// UP-MIND-05 (2026-09-05): widened past the CRUD trio so the service can
// emit the SEMANTIC act too. A generic entity.created says a row appeared;
// decision.recorded says a decision was made, which is the fact the Brain
// needs and the one it could never hear.
type Emit = (e: import("../events").EventInput) => void;

// Decision Record service. Typed adapter queries per the typed-queries law.
// Supersede links, never deletes: the old record stays readable with the new
// one on top. Delete is real (with a receipt and undo at the UI layer) and
// clears the older record's forward pointer so the chain stays honest.
export class DecisionService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}

  private async all(): Promise<DecisionRecord[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_DECISION);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as DecisionRecordData }));
  }

  // Newest first, live records only. Superseded records never appear in the
  // list; they stay reachable through the Replaces block of their successor.
  async list(): Promise<DecisionRecord[]> {
    const rows = await this.all();
    return rows
      .filter((r) => !r.data.supersededById)
      .sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  }

  // Every record, superseded included. The Replaces block reads through this.
  async listAll(): Promise<DecisionRecord[]> {
    const rows = await this.all();
    return rows.sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  }

  async get(id: string): Promise<DecisionRecord | null> {
    const it = await this.store.read(this.ownerId, id);
    return it ? { id: it.id, data: it.data as unknown as DecisionRecordData } : null;
  }

  // The payoff read: the newest live decision attached to a record. This is
  // what the project banner renders. Deterministic, no AI, no retrieval.
  async getByLink(type: DecisionLinkType, id: string): Promise<DecisionRecord | null> {
    const rows = await this.list();
    return rows.find((r) => r.data.linkedType === type && r.data.linkedId === id) ?? null;
  }

  // Revisits due today or earlier, still pending, oldest date first. Today
  // renders at most one per day; the sweep expires the rest of a passed day.
  async getRevisitsDue(localDate: string): Promise<DecisionRecord[]> {
    const rows = await this.list();
    return rows
      .filter((r) => r.data.revisitOn && r.data.revisitOn <= localDate && (r.data.revisitState === "pending" || r.data.revisitState === "shown"))
      .sort((a, b) => (a.data.revisitOn ?? "").localeCompare(b.data.revisitOn ?? ""));
  }

  async create(data: Omit<DecisionRecordData, "createdAt" | "updatedAt">): Promise<string | null> {
    const decision = data.decision.trim();
    if (!decision) return null;
    const now = new Date().toISOString();
    const full: DecisionRecordData = {
      ...data,
      decision,
      revisitState: data.revisitOn ? "pending" : "none",
      createdAt: now,
      updatedAt: now,
    };
    const id = await this.store.create(this.ownerId, ENTITY_DECISION, full as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_DECISION, entityId: id });
    // UP-MIND-05: a supersede reaches here through create() with the back
    // pointer already set, so the kind is read off the record rather than
    // from the call site, and both paths log the truth.
    this.onEvent({
      type: "decision.recorded",
      entityType: ENTITY_DECISION,
      entityId: id,
      props: { kind: full.supersedesId ? "superseded" : "new" },
    });
    return id;
  }

  // BRAIN-F-14 (2026-09-05): Undo of a delete is a RESTORE, not an intake.
  // create() is the intake path: it stamps createdAt and updatedAt with now
  // and forces revisitState from revisitOn, so an undone delete came back
  // reading "Recorded September 5", sorted to the top of the list, and with an
  // answered revisit pending on Today. This writes the kept record verbatim
  // under the id it had, and re-arms the forward pointer remove() cleared, so
  // a supersede chain reads exactly as it did before the delete.
  async restore(id: string, data: DecisionRecordData): Promise<string | null> {
    const decision = data.decision.trim();
    if (!decision) return null;
    const newId = await this.store.create(this.ownerId, ENTITY_DECISION, { ...data, decision } as unknown as ItemData, id);
    if (data.supersedesId) await this.update(data.supersedesId, { supersededById: newId });
    this.onEvent({ type: "entity.created", entityType: ENTITY_DECISION, entityId: newId });
    return newId;
  }

  async update(id: string, patch: Partial<DecisionRecordData>): Promise<boolean> {
    const cur = await this.get(id);
    if (!cur) return false;
    const next: DecisionRecordData = { ...cur.data, ...patch, updatedAt: new Date().toISOString() };
    if (typeof next.decision === "string") next.decision = next.decision.trim();
    // Setting a revisit date re-arms the lifecycle; clearing it disarms.
    if ("revisitOn" in patch) next.revisitState = patch.revisitOn ? "pending" : "none";
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_DECISION, entityId: id });
    return true;
  }

  // A reversal supersedes, it never deletes. Creates the new record pointing
  // back at the old one, then stamps the old record's forward pointer so it
  // drops out of the list but stays readable in the chain.
  async supersede(oldId: string, data: Omit<DecisionRecordData, "createdAt" | "updatedAt" | "supersedesId" | "supersededById">): Promise<string | null> {
    const old = await this.get(oldId);
    if (!old) return null;
    const newId = await this.create({ ...data, supersedesId: oldId });
    if (!newId) return null;
    await this.update(oldId, { supersededById: newId });
    return newId;
  }

  // Undo of a supersede: delete the new record and clear the old one's
  // forward pointer, restoring it to the list.
  async undoSupersede(newId: string): Promise<boolean> {
    const rec = await this.get(newId);
    if (!rec) return false;
    if (rec.data.supersedesId) await this.update(rec.data.supersedesId, { supersededById: undefined });
    await this.store.delete(this.ownerId, newId);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_DECISION, entityId: newId });
    return true;
  }

  // Real delete. If this record superseded an older one, the older record's
  // forward pointer is cleared so it returns to the list instead of pointing
  // at nothing.
  async remove(id: string): Promise<void> {
    const rec = await this.get(id);
    if (rec?.data.supersedesId) {
      const older = await this.get(rec.data.supersedesId);
      if (older?.data.supersededById === id) await this.update(older.id, { supersededById: undefined });
    }
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_DECISION, entityId: id });
  }

  // Still Good: stamp the confirmation and close the revisit.
  async confirmRevisit(id: string): Promise<boolean> {
    const ok = await this.update(id, { revisitState: "confirmed", confirmedAt: new Date().toISOString() });
    // UP-MIND-05: "still good" is a decision act in its own right, and the
    // one that says a call held up.
    if (ok) this.onEvent({ type: "decision.recorded", entityType: ENTITY_DECISION, entityId: id, props: { kind: "confirmed" } });
    return ok;
  }

  // Undo of Still Good: back to pending so it can render once more today.
  async unconfirmRevisit(id: string): Promise<boolean> {
    return this.update(id, { revisitState: "pending", confirmedAt: undefined });
  }

  // End-of-day sweep: any revisit whose day has passed without an answer
  // expires. Ignored means gone, not repeated. Returns how many expired.
  async expirePastRevisits(localDate: string): Promise<number> {
    const rows = await this.listAll();
    let n = 0;
    for (const r of rows) {
      const due = r.data.revisitOn;
      const st = r.data.revisitState;
      if (due && due < localDate && (st === "pending" || st === "shown")) {
        await this.update(r.id, { revisitState: "expired" });
        n++;
      }
    }
    return n;
  }
}
