import type { Store, ItemData } from "@core";

// A portable snapshot of everything this user owns. Entity ids are intentionally
// dropped on export; import creates fresh records so a bundle can be restored
// into any account without id collisions. (v1 import adds, it does not merge.)
export interface BackupItem {
  entityType: string;
  data: ItemData;
}
export interface BackupBundle {
  app: "jarvis";
  version: number;
  exportedAt: string;
  items: BackupItem[];
}

export class BackupService {
  constructor(private store: Store, private ownerId: string) {}

  async exportBundle(): Promise<BackupBundle> {
    const items = await this.store.listForUser(this.ownerId);
    return {
      app: "jarvis",
      version: 1,
      exportedAt: new Date().toISOString(),
      items: items.map((i) => ({ entityType: i.entityType, data: i.data })),
    };
  }

  // Returns the number of records written. Throws on a file that is not a
  // JARVIS backup so the UI can show a clear message.
  async importBundle(bundle: BackupBundle): Promise<number> {
    if (!bundle || bundle.app !== "jarvis" || !Array.isArray(bundle.items)) {
      throw new Error("This file is not a JARVIS backup.");
    }
    let n = 0;
    for (const it of bundle.items) {
      if (!it || typeof it.entityType !== "string" || typeof it.data !== "object" || it.data === null) continue;
      await this.store.create(this.ownerId, it.entityType, it.data as ItemData);
      n++;
    }
    return n;
  }
}
