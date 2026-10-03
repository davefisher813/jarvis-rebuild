import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter, type Item } from "@core";
import { WaitingService } from "./WaitingService";
import { ENTITY_WAITING, type WaitingData } from "./types";

class RecordingAdapter extends InMemoryAdapter {
  calls: (string | undefined)[] = [];
  override async listForUser(ownerId: string, entityType?: string): Promise<Item[]> {
    this.calls.push(entityType);
    return super.listForUser(ownerId, entityType);
  }
}

const U = "user-a";
const base: WaitingData = { title: "Peña transcript", waitingFor: "the transcript", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-03T12:00:00.000Z" };

describe("WaitingService", () => {
  it("lists with a typed adapter query, newest first", async () => {
    const adapter = new RecordingAdapter();
    const svc = new WaitingService(new Store(adapter), U);
    await svc.create(base);
    await svc.create({ ...base, title: "Rooming list", startedAt: "2026-10-04T12:00:00.000Z" });
    const rows = await svc.list();
    expect(adapter.calls).toContain(ENTITY_WAITING);
    expect(adapter.calls).not.toContain(undefined);
    expect(rows.map((r) => r.data.title)).toEqual(["Rooming list", "Peña transcript"]);
  });

  it("resolve and reopen change this one record's status and nothing else", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new WaitingService(store, U, () => {}, () => "2026-10-05T09:00:00.000Z");
    const id = await svc.create(base);
    expect(await svc.resolve(id, "  Came through on Monday ")).toBe(true);
    expect((await svc.get(id))!.data).toMatchObject({ status: "resolved", resolvedAt: "2026-10-05T09:00:00.000Z", resolutionNote: "Came through on Monday" });
    expect(await svc.reopen(id)).toBe(true);
    const back = (await svc.get(id))!.data;
    expect(back.status).toBe("open");
    expect(back.resolvedAt).toBeUndefined();
    expect(back.resolutionNote).toBeUndefined();
    expect(await store.listForUser(U, "task")).toEqual([]);
    expect(await store.listForUser(U, "event")).toEqual([]);
  });

  it("a follow-up date is tracker metadata: set, cleared, never a task", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new WaitingService(store, U);
    const id = await svc.create(base);
    await svc.setFollowUp(id, "2026-10-10");
    expect((await svc.get(id))!.data.followUpOn).toBe("2026-10-10");
    await svc.setFollowUp(id, null);
    expect((await svc.get(id))!.data.followUpOn).toBeUndefined();
    expect(await store.listForUser(U, "task")).toEqual([]);
  });

  it("remove returns the snapshot and a missing id is a plain false", async () => {
    const svc = new WaitingService(new Store(new InMemoryAdapter()), U);
    const id = await svc.create(base);
    const gone = await svc.remove(id);
    expect(gone?.data.title).toBe("Peña transcript");
    expect(await svc.get(id)).toBeNull();
    expect(await svc.resolve("nope")).toBe(false);
    expect(await svc.remove("nope")).toBeNull();
  });
});
