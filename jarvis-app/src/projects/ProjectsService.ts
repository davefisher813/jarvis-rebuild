import type { Store, ItemData } from "@core";
import { ENTITY_PROJECT, type Project, type ProjectData } from "./types";
import { normalizeProject, needsRepair } from "./backfill";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export class ProjectsService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}
  // BACKFILL ON READ (2026-08-21). Older records are missing fields the app
  // now assumes: a project with no status crashed its own detail page, and a
  // project with no order sorted by NaN. Normalising here repairs every
  // record everywhere at once, with no migration to half-run. The repair is
  // written back quietly, once, and never blocks the read.
  async list(): Promise<Project[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_PROJECT);
    const out = items.map((i, idx) => {
      const raw = i.data as unknown as ProjectData;
      const data = normalizeProject(raw, idx);
      if (data !== raw) void this.store.update(this.ownerId, i.id, data as unknown as ItemData).catch(() => {});
      return { id: i.id, data };
    });
    const order = { active: 0, on_hold: 1, done: 2 };
    return out.sort((a, b) => order[a.data.status] - order[b.data.status] || (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.title.localeCompare(b.data.title));
  }
  async get(id: string): Promise<Project | null> {
    const it = await this.store.read(this.ownerId, id);
    if (!it) return null;
    const raw = it.data as unknown as ProjectData;
    const data = normalizeProject(raw);
    if (needsRepair(raw)) void this.store.update(this.ownerId, it.id, data as unknown as ItemData).catch(() => {});
    return { id: it.id, data };
  }
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
