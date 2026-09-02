import type { Store, ItemData } from "@core";
import { ENTITY_FILE, type FileData, type FileScope, type UserFile } from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

// The rows about files (types.ts). Newest first, the way a pile of receipts
// reads: the one you just added is the one you are looking for.
export class FilesService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}

  async list(scope: FileScope): Promise<UserFile[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_FILE);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as FileData }))
      .filter((f) => f.data.scope === scope)
      .sort((a, b) => b.data.addedAt.localeCompare(a.data.addedAt));
  }

  async get(id: string): Promise<UserFile | null> {
    const it = await this.store.read(this.ownerId, id);
    return it ? { id: it.id, data: it.data as unknown as FileData } : null;
  }

  // The row is made BEFORE the bytes go up, because the storage path is
  // built from the row's id. A failed upload deletes the row again.
  async create(data: FileData): Promise<string> {
    const id = await this.store.create(this.ownerId, ENTITY_FILE, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_FILE, entityId: id });
    return id;
  }

  async update(id: string, patch: Partial<FileData>): Promise<boolean> {
    const f = await this.get(id);
    if (!f) return false;
    await this.store.update(this.ownerId, id, { ...f.data, ...patch } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_FILE, entityId: id });
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_FILE, entityId: id });
  }
}
