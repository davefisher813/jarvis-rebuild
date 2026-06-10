import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_CATEGORY, type Category, type CategoryData, type ColorSlot } from "./types";
import { DEFAULT_CATEGORIES, type TemplateKey } from "./defaults";

// The user's categories, backed by the engine Store. Each category is a Store
// item of entity type "category". onEvent feeds the gaming bus (no-op in tests).
export class CategoriesService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  async list(): Promise<Category[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_CATEGORY)
      .map((i) => ({ id: i.id, data: i.data as unknown as CategoryData }))
      .sort((a, b) => a.data.order - b.data.order);
  }

  async get(id: string): Promise<Category | null> {
    const item = await this.store.read(this.ownerId, id);
    if (!item || item.entityType !== ENTITY_CATEGORY) return null;
    return { id: item.id, data: item.data as unknown as CategoryData };
  }

  async create(name: string, color: ColorSlot, icon?: string): Promise<string | null> {
    if (!name || !name.trim()) return null;
    const order = (await this.list()).length;
    const data: CategoryData = { name: name.trim(), color, order };
    if (icon) data.icon = icon;
    const id = await this.store.create(this.ownerId, ENTITY_CATEGORY, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_CATEGORY, entityId: id });
    return id;
  }

  private async patch(id: string, patch: Partial<CategoryData>): Promise<boolean> {
    const c = await this.get(id);
    if (!c) return false;
    await this.store.update(this.ownerId, id, patch as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_CATEGORY, entityId: id });
    return true;
  }

  rename(id: string, name: string): Promise<boolean> {
    if (!name || !name.trim()) return Promise.resolve(false);
    return this.patch(id, { name: name.trim() });
  }

  recolor(id: string, color: ColorSlot): Promise<boolean> {
    return this.patch(id, { color });
  }

  setIcon(id: string, icon: string): Promise<boolean> {
    return this.patch(id, { icon });
  }

  // Merge a partial change into an existing category (preserves order/other fields).
  async update(id: string, patch: Partial<CategoryData>): Promise<boolean> {
    const c = await this.get(id);
    if (!c) return false;
    const next = { ...c.data, ...patch };
    if (typeof next.name === "string") next.name = next.name.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_CATEGORY, entityId: id });
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_CATEGORY, entityId: id });
  }

  // Persist a new order from an array of ids (index becomes the order field).
  async reorder(ids: string[]): Promise<void> {
    for (const [i, id] of ids.entries()) {
      await this.patch(id, { order: i });
    }
  }

  // Seed a template's defaults, but only if the user has no categories yet.
  // Returns the categories after seeding (or the existing ones, untouched).
  async seedDefaults(template: TemplateKey): Promise<Category[]> {
    const existing = await this.list();
    if (existing.length > 0) return existing;
    const seeds = DEFAULT_CATEGORIES[template];
    for (const [i, s] of seeds.entries()) {
      const data: CategoryData = { name: s.name, color: s.color, icon: s.icon, order: i };
      await this.store.create(this.ownerId, ENTITY_CATEGORY, data as unknown as ItemData);
    }
    return this.list();
  }
}
