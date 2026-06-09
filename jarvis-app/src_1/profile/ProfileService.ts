import type { Store, ItemData } from "@core";
import { ENTITY_PROFILE, EMPTY_PROFILE, type ProfileData } from "./types";

// The single per-user profile record, backed by the engine Store.
export class ProfileService {
  constructor(private store: Store, private ownerId: string) {}

  private async record(): Promise<{ id: string; data: ProfileData } | null> {
    const items = await this.store.listForUser(this.ownerId);
    const it = items.find((i) => i.entityType === ENTITY_PROFILE);
    return it ? { id: it.id, data: it.data as unknown as ProfileData } : null;
  }

  async get(): Promise<ProfileData | null> {
    const r = await this.record();
    return r ? r.data : null;
  }

  async isOnboarded(): Promise<boolean> {
    return (await this.get())?.onboarded ?? false;
  }

  // Create-or-update the single profile record, merged with the patch.
  async save(patch: Partial<ProfileData>): Promise<ProfileData> {
    const r = await this.record();
    if (r) {
      const next = { ...r.data, ...patch };
      await this.store.update(this.ownerId, r.id, next as unknown as ItemData);
      return next;
    }
    const next = { ...EMPTY_PROFILE, ...patch };
    await this.store.create(this.ownerId, ENTITY_PROFILE, next as unknown as ItemData);
    return next;
  }
}
