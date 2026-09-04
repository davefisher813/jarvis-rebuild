import type { Store, ItemData } from "@core";
import { ENTITY_PROFILE, EMPTY_PROFILE, type ProfileData } from "./types";
import { setAIControl } from "../ai/levelStore";

// The single per-user profile record, backed by the engine Store.
export class ProfileService {
  constructor(private store: Store, private ownerId: string) {}

  private async record(): Promise<{ id: string; data: ProfileData } | null> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_PROFILE);
    // Single-record entity, defended: if duplicates ever exist (a historical
    // create race), always read the newest by server time so edits can never
    // appear to flip between copies (audit 2026-07-30).
    const it = items
      .sort((a, b) => b.serverTime - a.serverTime)[0];
    return it ? { id: it.id, data: it.data as unknown as ProfileData } : null;
  }

  async get(): Promise<ProfileData | null> {
    const r = await this.record();
    // Mirror AI Control into the session singleton every time the profile is
    // read, so AIService and pre-generation obey the stored level without
    // any hook plumbing. The profile is read at app open (onboarding check),
    // which is what makes the level live before the first AI call.
    if (r) setAIControl(r.data.ai);
    return r ? r.data : null;
  }

  async isOnboarded(): Promise<boolean> {
    return (await this.get())?.onboarded ?? false;
  }

  // Create-or-update the single profile record, merged with the patch.
  //
  // B1-7 (2026-09-04): the network write carries ONLY the caller's patch,
  // never the full merged record. The server's item_apply_patch RPC already
  // does a field-level JSONB merge (core/supabaseAdapter.ts), which is built
  // exactly so two devices can each own a different field. Sending the whole
  // document defeated that: this device's own locally-cached read of fields
  // it never touched would ride along on every save and silently win a
  // last-write-wins race against whatever another device had just set on
  // those same fields. `next` still stands in as the optimistic local view
  // this call returns; it just never goes over the wire.
  async save(patch: Partial<ProfileData>): Promise<ProfileData> {
    const r = await this.record();
    if (r) {
      const next = { ...r.data, ...patch };
      await this.store.update(this.ownerId, r.id, patch as unknown as ItemData);
      setAIControl(next.ai);
      return next;
    }
    const next = { ...EMPTY_PROFILE, ...patch };
    await this.store.create(this.ownerId, ENTITY_PROFILE, next as unknown as ItemData);
    setAIControl(next.ai);
    return next;
  }
}
