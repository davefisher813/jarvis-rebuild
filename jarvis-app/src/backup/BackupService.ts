import type { Store, ItemData } from "@core";
import { ALL_ENTITY_TYPES } from "./entityRegistry";
import { remapReferences } from "./references";

// A portable snapshot of everything this user owns.
//
// PLUMB-F-12 (2026-09-05): v1 dropped the id of every record on export, to
// avoid collisions when restoring into another account. It avoided them by
// throwing away every link: a restored task's `category` still held the old
// account's category id, so a whole life came back uncategorized, projects
// lost their goal, goals their area, checklist tasks their note. v2 carries
// the id, and import assigns each record a fresh one and rewrites every
// reference field (see references.ts) to match before writing. A v1 bundle
// still imports exactly as it used to, links and all: there is nothing in it
// to rewrite from.
export interface BackupItem {
  entityType: string;
  data: ItemData;
  // The id the record had in the account it was exported from. Absent in v1
  // bundles.
  id?: string;
}
export interface BackupBundle {
  app: "jarvis";
  version: number;
  exportedAt: string;
  items: BackupItem[];
}

// v2 adds `id` per item (PLUMB-F-12). Import accepts either version.
export const BUNDLE_VERSION = 2;

// A uuid for a record about to be restored. Same shape and the same reason
// as the store's own generator (PLUMB-F-01: item.id is a uuid column, so an
// id that is not uuid-shaped is rejected on write), kept local because the
// core does not export it.
function freshId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  let s = "";
  for (let i = 0; i < 32; i++) s += i === 12 ? "4" : i === 16 ? (8 + Math.floor(Math.random() * 4)).toString(16) : hex();
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}

// Entity types this app knows how to render. Import refuses to write anything
// else, so a tampered or future-version bundle can't seed unrenderable rows.
//
// S3-Q15 (2026-09-04): was a hand-typed 11-entry list that silently dropped
// the other 21 real entity types this app has shipped since it was written.
// Now derived from the one canonical registry (entityRegistry.ts) so a new
// feature's entity type is restorable the moment it's added there.
const KNOWN_TYPES = new Set(ALL_ENTITY_TYPES);

// A bundle entry with the two fields an import cannot proceed without.
function isImportable(it: BackupItem | null | undefined): it is BackupItem {
  return !!it && typeof it.entityType === "string" && typeof it.data === "object" && it.data !== null;
}

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
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      items: items.map((i) => ({ entityType: i.entityType, data: i.data, id: i.id })),
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
    const rows = await this.store.listForUser(this.ownerId);
    // Skip exact duplicates (2026-08-09): running the same import twice used
    // to double every task, note, and event. An item identical in type and
    // content to one already present has nothing to restore.
    const existing = new Set(rows.map((i) => i.entityType + ":" + JSON.stringify(i.data)));
    const existingIds = new Set(rows.map((i) => i.id));

    // PLUMB-F-12 pass one: decide the id every record will land under BEFORE
    // writing anything, so a reference can be rewritten whichever direction
    // it points. Ordering by dependency would not have been enough: the
    // links run in cycles (a task names the note it came from, and that
    // note's checklist line names the task), and there is no order in which
    // both ends already exist.
    //
    // An id the account already holds maps to ITSELF, which is what makes
    // re-importing a backup into the account it came from a no-op instead of
    // a second copy of everything with rewritten links.
    //
    // Byte-identical twins in one bundle share one new id, because the
    // content dedupe below will only write the first of them: anything
    // pointing at either twin has to land on the row that actually exists.
    const idMap = new Map<string, string>();
    const idByShape = new Map<string, string>();
    for (const it of bundle.items) {
      if (!isImportable(it) || !KNOWN_TYPES.has(it.entityType)) continue;
      const oldId = typeof it.id === "string" && it.id ? it.id : null;
      if (!oldId || idMap.has(oldId)) continue;
      if (existingIds.has(oldId)) { idMap.set(oldId, oldId); continue; }
      const shape = it.entityType + ":" + JSON.stringify(it.data);
      let assigned = idByShape.get(shape);
      if (!assigned) { assigned = freshId(); idByShape.set(shape, assigned); }
      idMap.set(oldId, assigned);
    }

    const created: string[] = [];
    const unsupportedTypes: string[] = [];
    const seenUnsupported = new Set<string>();
    let n = 0;
    try {
      for (const it of bundle.items) {
        if (!isImportable(it)) continue;
        if (!KNOWN_TYPES.has(it.entityType)) {
          if (!seenUnsupported.has(it.entityType)) {
            seenUnsupported.add(it.entityType);
            unsupportedTypes.push(it.entityType);
          }
          continue;
        }
        const oldId = typeof it.id === "string" && it.id ? it.id : null;
        // The account already holds this exact record under this exact id.
        // Import adds, it never overwrites, so the copy in the file (which
        // may be older than what is here) is left in the file.
        if (oldId && existingIds.has(oldId)) continue;
        const data = remapReferences(it.entityType, it.data, idMap);
        const key = it.entityType + ":" + JSON.stringify(data);
        if (existing.has(key)) continue;
        const id = await this.store.create(this.ownerId, it.entityType, data as ItemData, oldId ? idMap.get(oldId) : undefined);
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
