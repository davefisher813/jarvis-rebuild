import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Store, InMemoryAdapter } from "@core";
import { HealthService } from "../health/HealthService";
import { GymService } from "../gym/GymService";
import { queueHealthLog, readPending, type Storage2 } from "../health/offlineQueue";
import { queueFinished, readPending as readGymPending } from "../gym/liveSession";
import type { WorkoutData } from "../gym/types";

// HEALTH LAW 9: IDEMPOTENT CREATE (Build Master 2026-09-12, section 7 item
// 9; Health Push F, H-51). A queued log flushed twice with the same clientId
// produces one row. The phone stamps the id when it queues; a flush whose
// answer was lost replays the same entry; the adapter answers with the row
// that already landed. Held at the adapter (the in-memory one here, the
// Supabase one through migration 0039's unique index and its 23505 path).

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

const workout = (): WorkoutData => ({ programId: "p", dayId: "d", dayName: "Push", date: "2026-09-13", startedAt: 1, endedAt: 2, exercises: [] });

describe("HEALTH LAW 9: a queued write replayed with the same clientId is one row", () => {
  it("a health log saved twice from the queue lands once", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new HealthService(store, "athlete1");
    const q = mem();
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1000 } }, q);
    const entry = readPending(q)[0]!;
    expect(typeof entry.data.clientId).toBe("string");
    const first = await svc.saveQueued(entry);
    const second = await svc.saveQueued(entry);
    expect(second).toBe(first);
    expect(await store.listForUser("athlete1", "health_took_it")).toHaveLength(1);
  });

  it("a finished workout saved twice from the queue lands once", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new GymService(store, "athlete1");
    const q = mem();
    queueFinished(workout(), q);
    const w = readGymPending(q)[0]!;
    expect(typeof w.clientId).toBe("string");
    const first = await svc.saveWorkout(w);
    const second = await svc.saveWorkout(w);
    expect(second).toBe(first);
    expect(await store.listForUser("athlete1", "workout")).toHaveLength(1);
  });

  it("the same clientId for two owners is two rows, and a write with no clientId is never folded", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.create("a", "health_took_it", { category: "medication", at: 1, clientId: "c1" });
    await adapter.create("b", "health_took_it", { category: "medication", at: 1, clientId: "c1" });
    await adapter.create("a", "health_took_it", { category: "medication", at: 1 });
    await adapter.create("a", "health_took_it", { category: "medication", at: 1 });
    expect(await adapter.listForUser("a", "health_took_it")).toHaveLength(3);
    expect(await adapter.listForUser("b", "health_took_it")).toHaveLength(1);
  });

  it("the Supabase adapter and the schema hold the same rule", () => {
    const root = join(process.cwd(), "..", "jarvis-core");
    const adapter = readFileSync(join(root, "src", "core", "supabaseAdapter.ts"), "utf8");
    const start = adapter.indexOf("async create(");
    const body = adapter.slice(start, adapter.indexOf("\n  }", start));
    expect(body, "a duplicate clientId must resolve to the landed row").toMatch(/23505/);
    expect(body).toMatch(/data->>clientId/);
    const migration = join(root, "supabase", "migrations", "0039_item_client_id_unique.sql");
    expect(existsSync(migration), "migration 0039 must exist").toBe(true);
    const sql = readFileSync(migration, "utf8");
    expect(sql).toMatch(/create unique index if not exists/i);
    expect(sql).toMatch(/\(owner_id, \(data->>'clientId'\)\)/);
    expect(sql).toMatch(/where data \? 'clientId'/);
  });
});
