import type { Store, ItemData } from "@core";
import { ENTITY_PROJECT, type Project, type ProjectData } from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export class ProjectsService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}
  async list(): Promise<Project[]> {
    const items = await this.store.listForUser(this.ownerId);
    const order = { active: 0, on_hold: 1, done: 2 };
    return items.filter((i) => i.entityType === ENTITY_PROJECT).map((i) => ({ id: i.id, data: i.data as unknown as ProjectData }))
      .sort((a, b) => order[a.data.status] - order[b.data.status] || (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.title.localeCompare(b.data.title));
  }
  async get(id: string): Promise<Project | null> { const it = await this.store.read(this.ownerId, id); return it ? { id: it.id, data: it.data as unknown as ProjectData } : null; }
  async create(data: ProjectData): Promise<string | null> {
    if (!data.title.trim()) return null;
    const id = await this.store.create(this.ownerId, ENTITY_PROJECT, { ...data, title: data.title.trim() } as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_PROJECT, entityId: id });
    return id;
  }
  async update(id: string, patch: Partial<ProjectData>): Promise<boolean> {
    const p = await this.get(id); if (!p) return false;
    const next = { ...p.data, ...patch }; if (typeof next.title === "string") next.title = next.title.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_PROJECT, entityId: id });
    return true;
  }
  async remove(id: string): Promise<void> { await this.store.delete(this.ownerId, id); this.onEvent({ type: "entity.deleted", entityType: ENTITY_PROJECT, entityId: id }); }
}
