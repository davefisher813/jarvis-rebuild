import type { Store, ItemData } from "@core";
import { ENTITY_GOAL, type Goal, type GoalData } from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export class GoalService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}
  async list(): Promise<Goal[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items.filter((i) => i.entityType === ENTITY_GOAL).map((i) => ({ id: i.id, data: i.data as unknown as GoalData }))
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.title.localeCompare(b.data.title));
  }
  async get(id: string): Promise<Goal | null> { const it = await this.store.read(this.ownerId, id); return it ? { id: it.id, data: it.data as unknown as GoalData } : null; }
  async create(data: GoalData): Promise<string | null> {
    if (!data.title.trim()) return null;
    const id = await this.store.create(this.ownerId, ENTITY_GOAL, { ...data, title: data.title.trim() } as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_GOAL, entityId: id });
    return id;
  }
  async update(id: string, patch: Partial<GoalData>): Promise<boolean> {
    const g = await this.get(id); if (!g) return false;
    const next = { ...g.data, ...patch }; if (typeof next.title === "string") next.title = next.title.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_GOAL, entityId: id });
    return true;
  }
  async remove(id: string): Promise<void> { await this.store.delete(this.ownerId, id); this.onEvent({ type: "entity.deleted", entityType: ENTITY_GOAL, entityId: id }); }
}
