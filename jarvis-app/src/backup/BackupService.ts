import type { Store, ItemData } from "@core";
import { ALL_ENTITY_TYPES } from "./entityRegistry";

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
//
// S3-Q15 (2026-09-04): was a hand-typed 11-entry list that silently dropped
// the other 21 real entity types this app has shipped since it was written.
// Now derived from the one canonical registry (entityRegistry.ts) so a new
// feature's entity type is restorable the moment it's added there.
const KNOWN_TYPES = new Set(ALL_ENTITY_TYPES);

export interface ImportResult {
  // Records actually written. A duplicate of something already in the
  // account, in the bundle, or created earlier in this same import doesn't
  // count -- see the dedupe note below.
  imported: number;
  // Entity type names the bundle carried that this build doesn't recognize,
  // in first-seen order, each named once. The honest counterpart to a
  // duplicate skip: not "already here," but "this build has no such entity
  // at all" -- most likely an older backup restored into a newer build, or
  // (before this fix) a newer backup restored into an older one. Empty when
  // the bundle was fully understood.
  unsupportedTypes: string[];
}

export class BackupService {
  constructor(private store: Store, private ownerId: string) {}

  async exportBundle(): Promise<BackupBundle> {
    // Deliberately untyped: export means EVERY record in the account. This is
    // the one sanctioned whole-account read (corrections pack 2026-08-14
    // item 4); feature services always pass their entity type.
    const items = await this.store.listForUser(this.ownerId);
    return {
      app: "jarvis",
      version: 1,
      exportedAt: new Date().toISOString(),
      items: items.map((i) => ({ entityType: i.entityType, data: i.data })),
    };
  }

  // Returns how many records were written, plus the name of every entity type
  // the bundle carried that this build can't render (S3-Q15: reported, not
  // silently dropped). Throws on a file that is not a JARVIS backup so the UI
  // can show a clear message.
  //
  // All-or-nothing: if any write fails mid-loop, every record this import
  // already created is deleted before the error surfaces, so a half-restored
  // account can't happen. Unsupported entity types are still skipped, never
  // written -- this build genuinely cannot render them -- but their names are
  // collected instead of vanishing.
  async importBundle(bundle: BackupBundle): Promise<ImportResult> {
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
    const unsupportedTypes: string[] = [];
    const seenUnsupported = new Set<string>();
    let n = 0;
    try {
      for (const it of bundle.items) {
        if (!it || typeof it.entityType !== "string" || typeof it.data !== "object" || it.data === null) continue;
        if (!KNOWN_TYPES.has(it.entityType)) {
          if (!seenUnsupported.has(it.entityType)) {
            seenUnsupported.add(it.entityType);
            unsupportedTypes.push(it.entityType);
          }
          continue;
        }
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
      throw new Error("Import failed · Rolled back · Nothing changed");
    }
    return { imported: n, unsupportedTypes };
  }
}
