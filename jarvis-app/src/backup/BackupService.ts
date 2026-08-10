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

// Entity types this app knows how to render. Import refuses to write anything
// else, so a tampered or future-version bundle can't seed unrenderable rows.
const KNOWN_TYPES = new Set([
  "note", "task", "event", "category", "person", "profile",
  "project", "goal", "life_area", "account", "routine",
]);

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
  //
  // All-or-nothing: if any write fails mid-loop, every record this import
  // already created is deleted before the error surfaces, so a half-restored
  // account can't happen. Unknown entity types are skipped, never written.
  async importBundle(bundle: BackupBundle): Promise<number> {
    if (!bundle || bundle.app !== "jarvis" || !Array.isArray(bundle.items)) {
      throw new Error("This file is not a JARVIS backup.");
    }
    // Skip exact duplicates (2026-08-09): running the same import twice used
    // to double every task, note, and event. An item identical in type and
    // content to one already present has nothing to restore.
    const existing = new Set(
      (await this.store.listForUser(this.ownerId)).map((i) => i.entityType + ":" + JSON.stringify(i.data)),
    );
    const created: string[] = [];
    let n = 0;
    try {
      for (const it of bundle.items) {
        if (!it || typeof it.entityType !== "string" || typeof it.data !== "object" || it.data === null) continue;
        if (!KNOWN_TYPES.has(it.entityType)) continue;
        const key = it.entityType + ":" + JSON.stringify(it.data);
        if (existing.has(key)) continue;
        const id = await this.store.create(this.ownerId, it.entityType, it.data as ItemData);
        existing.add(key);
        created.push(id);
        n++;
      }
    } catch (err) {
      for (const id of created.reverse()) {
        try { await this.store.delete(this.ownerId, id); } catch { /* keep rolling back */ }
      }
      throw new Error("Import failed part-way; everything was rolled back. Nothing was changed.");
    }
    return n;
  }
}
