import type { Store, ItemData } from "@core";
import { ENTITY_ROUTINE, DEFAULT_ROUTINE, type RoutineData } from "./types";

// The single per-user routine record, backed by the engine Store. Mirrors
// ProfileService: one record per user, create-or-update, defaults on first read.
export class RoutineService {
  constructor(private store: Store, private ownerId: string) {}

  private async record(): Promise<{ id: string; data: RoutineData } | null> {
    const items = await this.store.listForUser(this.ownerId);
    // Single-record entity, defended: if duplicates ever exist (a historical
    // create race), always read the newest by server time so edits can never
    // appear to flip between copies (audit 2026-07-30).
    const it = items
      .filter((i) => i.entityType === ENTITY_ROUTINE)
      .sort((a, b) => b.serverTime - a.serverTime)[0];
    return it ? { id: it.id, data: it.data as unknown as RoutineData } : null;
  }

  // Always returns a usable routine: the saved record merged over defaults, or
  // the defaults alone if the user has never set one up.
  async get(): Promise<RoutineData> {
    const r = await this.record();
    return r ? { ...DEFAULT_ROUTINE, ...r.data } : { ...DEFAULT_ROUTINE };
  }

  // True once the user has saved a routine at least once. Used to nudge new
  // users who are still on the default hours.
  async isConfigured(): Promise<boolean> {
    return (await this.record()) !== null;
  }

  // Create-or-update the single routine record, merged with the patch.
  async save(patch: Partial<RoutineData>): Promise<RoutineData> {
    const r = await this.record();
    if (r) {
      const next = { ...DEFAULT_ROUTINE, ...r.data, ...patch };
      await this.store.update(this.ownerId, r.id, next as unknown as ItemData);
      return next;
    }
    const next = { ...DEFAULT_ROUTINE, ...patch };
    await this.store.create(this.ownerId, ENTITY_ROUTINE, next as unknown as ItemData);
    return next;
  }
}
