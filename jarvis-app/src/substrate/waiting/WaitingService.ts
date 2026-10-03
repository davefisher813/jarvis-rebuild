import type { Store, ItemData } from "@core";
import { ENTITY_WAITING, type WaitingData, type WaitingItem } from "./types";

type Emit = (e: import("../../events").EventInput) => void;

// The Waiting store (spec E12, E13). Typed adapter queries per the typed
// queries law. Resolve and reopen change one record's status and nothing
// else: no outbound mail, no task, no event. A remove returns the snapshot so
// a screen can offer Undo.
export class WaitingService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: Emit = () => {},
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async list(): Promise<WaitingItem[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_WAITING);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as WaitingData }))
      .sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt));
  }

  async get(id: string): Promise<WaitingItem | null> {
    const it = await this.store.read(this.ownerId, id);
    if (!it || it.entityType !== ENTITY_WAITING) return null;
    return { id: it.id, data: it.data as unknown as WaitingData };
  }

  /** `id` is for a restore (Undo of a remove) or a server-assigned id. */
  async create(data: WaitingData, id?: string): Promise<string> {
    const made = await this.store.create(this.ownerId, ENTITY_WAITING, data as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_WAITING, entityId: made });
    return made;
  }

  private async patch(id: string, patch: Partial<WaitingData>): Promise<boolean> {
    const cur = await this.get(id);
    if (!cur) return false;
    await this.store.update(this.ownerId, id, patch as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_WAITING, entityId: id });
    return true;
  }

  /** The person confirms it arrived, or stopped mattering. Note optional. */
  resolve(id: string, note?: string): Promise<boolean> {
    return this.patch(id, { status: "resolved", resolvedAt: this.now(), ...(note?.trim() ? { resolutionNote: note.trim() } : {}) });
  }

  reopen(id: string): Promise<boolean> {
    return this.patch(id, { status: "open", resolvedAt: undefined, resolutionNote: undefined });
  }

  /** A local follow-up date. null clears it. Never a task or an event. */
  setFollowUp(id: string, date: string | null): Promise<boolean> {
    return this.patch(id, { followUpOn: date ?? undefined });
  }

  async remove(id: string): Promise<WaitingItem | null> {
    const cur = await this.get(id);
    if (!cur) return null;
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_WAITING, entityId: id });
    return cur;
  }
}
