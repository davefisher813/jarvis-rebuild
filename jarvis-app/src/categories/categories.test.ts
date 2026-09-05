import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { CategoriesService } from "./CategoriesService";
import { DEFAULT_CATEGORIES } from "./defaults";
import { COLOR_SLOTS } from "./types";

describe("CategoriesService", () => {
  it("creates a category and lists it, ordered", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const a = await svc.create("Work", "blue", "briefcase");
    const b = await svc.create("Family", "pink");
    expect(a).toBeTruthy();
    const list = await svc.list();
    expect(list.map((c) => c.data.name)).toEqual(["Work", "Family"]);
    expect(list.map((c) => c.data.order)).toEqual([0, 1]);
    expect(list.map((c) => c.data.icon)).toEqual(["briefcase", undefined]);
    expect(b).toBeTruthy();
  });

  it("rejects an empty name", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    expect(await svc.create("  ", "red")).toBeNull();
    expect((await svc.list()).length).toBe(0);
  });

  it("renames, recolors, and sets icon by id", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create("Work", "blue"))!;
    expect(await svc.rename(id, "Ridgeley")).toBe(true);
    expect(await svc.recolor(id, "sky")).toBe(true);
    expect(await svc.setIcon(id, "building")).toBe(true);
    const c = await svc.get(id);
    expect(c?.data).toMatchObject({ name: "Ridgeley", color: "sky", icon: "building" });
  });

  it("rename rejects empty and unknown id", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create("Work", "blue"))!;
    expect(await svc.rename(id, "  ")).toBe(false);
    expect(await svc.rename("nope", "X")).toBe(false);
  });

  it("removes a category", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create("Temp", "teal"))!;
    await svc.remove(id);
    expect((await svc.list()).length).toBe(0);
  });

  it("reorders by id list", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const a = (await svc.create("A", "red"))!;
    const b = (await svc.create("B", "green"))!;
    const c = (await svc.create("C", "blue"))!;
    await svc.reorder([c, a, b]);
    expect((await svc.list()).map((x) => x.data.name)).toEqual(["C", "A", "B"]);
  });

  it("seeds a template's defaults only when empty", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const seeded = await svc.seedDefaults("personal");
    expect(seeded.map((c) => c.data.name)).toEqual(
      DEFAULT_CATEGORIES.personal.map((s) => s.name),
    );
    // idempotent: seeding again is a no-op
    const again = await svc.seedDefaults("business");
    expect(again.map((c) => c.data.name)).toEqual(
      DEFAULT_CATEGORIES.personal.map((s) => s.name),
    );
  });

  it("every default across all templates uses a valid color slot", () => {
    Object.values(DEFAULT_CATEGORIES).forEach((set) =>
      set.forEach((s) => expect(COLOR_SLOTS).toContain(s.color)),
    );
  });

  it("isolates categories per user", async () => {
    const store = new Store(new InMemoryAdapter());
    const u1 = new CategoriesService(store, "u1");
    const u2 = new CategoriesService(store, "u2");
    await u1.create("Mine", "blue");
    expect((await u2.list()).length).toBe(0);
  });
});

// BRAIN-F-01 / SCHED-F-01 (2026-09-05): Wake Up writes `{ season: undefined }`,
// which never reached Supabase (JSON drops the key), so a paused area was
// Paused again after the next refresh. The in-memory adapter now merges the
// way the server does; this proves the unpause lands.
describe("BRAIN-F-01: Wake Up and Paused off clear season on the row", () => {
  it("Wake Up removes season entirely", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create("Work", "blue"))!;
    await svc.update(id, { kind: "org", season: "paused" });
    expect((await svc.get(id))!.data.season).toBe("paused");
    await svc.update(id, { season: undefined });
    const d = (await svc.get(id))!.data;
    expect(Object.prototype.hasOwnProperty.call(d, "season")).toBe(false);
    expect(d.kind).toBe("org");
  });

  it("the sheet's Paused switch off (full patch with season undefined) clears it too", async () => {
    const svc = new CategoriesService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create("Work", "blue"))!;
    await svc.update(id, { kind: "org", season: "paused", workHours: true });
    await svc.update(id, { name: "Work", color: "blue", icon: "briefcase", kind: "org", season: undefined, workHours: undefined });
    const d = (await svc.get(id))!.data;
    expect(Object.prototype.hasOwnProperty.call(d, "season")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(d, "workHours")).toBe(false);
    expect(d.icon).toBe("briefcase");
  });
});
