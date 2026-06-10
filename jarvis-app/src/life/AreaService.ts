import type { Store, ItemData } from "@core";
import { ENTITY_AREA, type Area, type AreaData } from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export class AreaService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}
  async list(): Promise<Area[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items.filter((i) => i.entityType === ENTITY_AREA).map((i) => ({ id: i.id, data: i.data as unknown as AreaData }))
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }
  async get(id: string): Promise<Area | null> { const it = await this.store.read(this.ownerId, id); return it ? { id: it.id, data: it.data as unknown as AreaData } : null; }
  async create(data: AreaData): Promise<string | null> {
    if (!data.name.trim()) return null;
    const id = await this.store.create(this.ownerId, ENTITY_AREA, { ...data, name: data.name.trim() } as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_AREA, entityId: id });
    return id;
  }
  async update(id: string, patch: Partial<AreaData>): Promise<boolean> {
    const a = await this.get(id); if (!a) return false;
    const next = { ...a.data, ...patch }; if (typeof next.name === "string") next.name = next.name.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_AREA, entityId: id });
    return true;
  }
  async remove(id: string): Promise<void> { await this.store.delete(this.ownerId, id); this.onEvent({ type: "entity.deleted", entityType: ENTITY_AREA, entityId: id }); }
}
