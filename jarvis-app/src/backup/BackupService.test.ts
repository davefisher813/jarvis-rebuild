import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { BackupService, type BackupBundle } from "./BackupService";

describe("BackupService", () => {
  it("exports all owned items and imports them into another store", async () => {
    const a = new Store(new InMemoryAdapter());
    await a.create("u1", "task", { title: "A", done: false } as never);
    await a.create("u1", "task", { title: "B", done: true } as never);
    await a.create("u1", "event", { title: "Standup", date: "2026-05-24", start: "09:00" } as never);

    const bundle = await new BackupService(a, "u1").exportBundle();
    expect(bundle.app).toBe("jarvis");
    expect(bundle.items.length).toBe(3);
    expect(bundle.items.every((i) => "entityType" in i && "data" in i)).toBe(true);

    const b = new Store(new InMemoryAdapter());
    const n = await new BackupService(b, "u2").importBundle(bundle);
    expect(n).toBe(3);
    expect((await b.listForUser("u2")).length).toBe(3);
  });

  it("rejects a non-JARVIS file", async () => {
    const s = new BackupService(new Store(new InMemoryAdapter()), "u1");
    await expect(s.importBundle({ foo: 1 } as never)).rejects.toThrow();
  });
});

describe("import hardening", () => {
  it("skips unknown entity types", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BackupService(store, "u");
    const n = await svc.importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "task", data: { text: "ok" } },
        { entityType: "malware_payload", data: { boom: 1 } },
      ],
    } as never);
    expect(n).toBe(1);
    const rows = await store.listForUser("u");
    expect(rows.every((r) => r.entityType === "task")).toBe(true);
  });

  it("rolls back everything when a write fails mid-loop", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BackupService(store, "u");
    let calls = 0;
    const realCreate = store.create.bind(store);
    store.create = async (o, t, d) => {
      calls++;
      if (calls === 3) throw new Error("db down");
      return realCreate(o, t, d);
    };
    await expect(svc.importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "task", data: { text: "a" } },
        { entityType: "task", data: { text: "b" } },
        { entityType: "task", data: { text: "c" } },
      ],
    } as never)).rejects.toThrow(/rolled back/);
    expect((await store.listForUser("u")).length).toBe(0);
  });
});

// Import dedupe (2026-08-09): the same file twice must not double a life.
describe("importBundle dedupe", () => {
  it("skips items identical to ones already present and reports only real writes", async () => {
    const svc = new BackupService(new Store(new InMemoryAdapter()), "u-dedupe");
    const bundle: BackupBundle = {
      app: "jarvis", version: 1, exportedAt: "2026-08-01T00:00:00Z",
      items: [
        { entityType: "task", data: { text: "Pay rent", done: false } },
        { entityType: "note", data: { title: "Ideas", category: "", blocks: [], connections: [] } },
      ] as BackupBundle["items"],
    };
    expect(await svc.importBundle(bundle)).toBe(2);
    expect(await svc.importBundle(bundle)).toBe(0); // second run: everything exists
    const again = await svc.exportBundle();
    expect(again.items.filter((i) => i.entityType === "task")).toHaveLength(1);
  });
});
