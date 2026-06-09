import { describe, it, expect } from "vitest";
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
});
