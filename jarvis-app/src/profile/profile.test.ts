import { describe, it, expect, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ProfileService } from "./ProfileService";

describe("ProfileService", () => {
  it("returns null before onboarding, false for isOnboarded", async () => {
    const svc = new ProfileService(new Store(new InMemoryAdapter()), "u1");
    expect(await svc.get()).toBeNull();
    expect(await svc.isOnboarded()).toBe(false);
  });

  it("creates then updates a single record (no duplicates)", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new ProfileService(store, "u1");
    await svc.save({ name: "Alex", template: "student" });
    await svc.save({ onboarded: true, briefTime: "07:00" });
    const p = await svc.get();
    expect(p).toMatchObject({ name: "Alex", template: "student", onboarded: true, briefTime: "07:00" });
    expect((await store.listForUser("u1")).filter((i) => i.entityType === "profile").length).toBe(1);
  });

  it("isolates profiles per user", async () => {
    const store = new Store(new InMemoryAdapter());
    await new ProfileService(store, "u1").save({ name: "Alex" });
    expect(await new ProfileService(store, "u2").get()).toBeNull();
  });

  // B1-7 (2026-09-04): "a settings change on one device reverts the other."
  describe("cross-device writes", () => {
    it("sends only the caller's patch fields over the write, never the full merged record", async () => {
      const store = new Store(new InMemoryAdapter());
      const svc = new ProfileService(store, "u1");
      await svc.save({ name: "Alex", template: "student" });
      const spy = vi.spyOn(store, "update");
      await svc.save({ template: "business" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![2]).toEqual({ template: "business" });
    });

    it("a field one device just wrote survives an unrelated save from another device's stale cached read", async () => {
      // Two devices, two Store instances (each with its own short-lived read
      // cache), one shared backend adapter, exactly like two phones against
      // one Supabase project.
      const adapter = new InMemoryAdapter();
      const deviceA = new ProfileService(new Store(adapter), "u1");
      const deviceB = new ProfileService(new Store(adapter), "u1");
      await deviceA.save({ name: "Alex", trackOpens: true });
      // Device A reads and caches the current record locally.
      await deviceA.get();
      // Device B independently flips a field on the shared backend.
      await deviceB.save({ trackOpens: false });
      // Device A, still holding its own (now stale) cached read, saves an
      // unrelated field. Its stale view of "trackOpens" must never ride
      // along and overwrite what device B just set.
      await deviceA.save({ planCap: 3 });
      const p = await deviceB.get();
      expect(p?.trackOpens).toBe(false);
      expect(p?.planCap).toBe(3);
    });
  });
});
