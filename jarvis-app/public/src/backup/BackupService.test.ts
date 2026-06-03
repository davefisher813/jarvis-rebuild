import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { BackupService } from "./BackupService";

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
