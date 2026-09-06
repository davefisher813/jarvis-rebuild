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
    const items = await this.store.listForUser(this.ownerId, ENTITY_CATEGORY);
    return items
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

  // SHELL-F-25 (2026-09-05): rename, recolor and setIcon went. Nothing called
  // them: CategorySheet edits name, colour and icon together and saves them
  // as one change through update(), which is right -- three separate writes
  // for one sheet is three chances to land half an edit.

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

  // BRAIN-F-10 (2026-09-05, fork option A). Undo of an area delete used to
  // call create(), which mints a NEW id and takes three fields: the area came
  // back empty, every task, note, event, project and person that carried the
  // old id stayed untagged, and the org's Paused / Work Hours settings and its
  // kind were gone. This puts the record back exactly as it was, under the id
  // it had, so every reference resolves. The Store has taken an id since the
  // offline queue's replay (HMN-F-15); only ever pass one whose row is gone.
  async restore(id: string, data: CategoryData): Promise<string | null> {
    if (!data.name || !data.name.trim()) return null;
    const newId = await this.store.create(this.ownerId, ENTITY_CATEGORY, { ...data, name: data.name.trim() } as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_CATEGORY, entityId: newId });
    return newId;
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
      const id = await this.store.create(this.ownerId, ENTITY_CATEGORY, data as unknown as ItemData);
      // SHELL-F-15 (2026-09-05): this wrote straight to the store and told
      // nobody, because it predates the bus-driven category registry. So the
      // areas a template seeded from Profile > Template resolved to no name
      // and no colour anywhere in the app until the next relaunch. Every
      // other write in this file announces itself; so does this one.
      this.onEvent({ type: "entity.created", entityType: ENTITY_CATEGORY, entityId: id });
    }
    return this.list();
  }
}
