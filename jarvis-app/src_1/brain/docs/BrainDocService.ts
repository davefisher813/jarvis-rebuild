import type { Store, ItemData } from "@core";
import { ENTITY_BRAIN_DOC, type BrainDocData } from "./types";

// One record per topic per user (philosophy / writing / values).
export class BrainDocService {
  constructor(private store: Store, private ownerId: string) {}

  private async record(topic: string): Promise<{ id: string; data: BrainDocData } | null> {
    const items = await this.store.listForUser(this.ownerId);
    const it = items.find((i) => i.entityType === ENTITY_BRAIN_DOC && (i.data as unknown as BrainDocData).topic === topic);
    return it ? { id: it.id, data: it.data as unknown as BrainDocData } : null;
  }

  async get(topic: string): Promise<string> {
    return (await this.record(topic))?.data.text ?? "";
  }

  async save(topic: string, text: string): Promise<void> {
    const r = await this.record(topic);
    const data: BrainDocData = { topic, text };
    if (r) await this.store.update(this.ownerId, r.id, data as unknown as ItemData);
    else await this.store.create(this.ownerId, ENTITY_BRAIN_DOC, data as unknown as ItemData);
  }
}
