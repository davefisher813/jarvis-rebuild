import type { Store, ItemData } from "@core";
import { ENTITY_PERSON, type Person, type PersonData, type PersonGroup } from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export class PeopleService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}

  async list(group?: PersonGroup): Promise<Person[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_PERSON)
      .map((i) => ({ id: i.id, data: i.data as unknown as PersonData }))
      .filter((p) => !group || p.data.group === group)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }

  async get(id: string): Promise<Person | null> {
    const it = await this.store.read(this.ownerId, id);
    return it ? { id: it.id, data: it.data as unknown as PersonData } : null;
  }

  async create(data: PersonData): Promise<string | null> {
    if (!data.name || !data.name.trim()) return null;
    const clean: PersonData = { ...data, name: data.name.trim() };
    const id = await this.store.create(this.ownerId, ENTITY_PERSON, clean as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_PERSON, entityId: id });
    return id;
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
}
