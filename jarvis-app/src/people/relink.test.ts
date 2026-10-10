// relinkData: every place a row points at a person, including the three
// paths Phase 0 D2 added (a reminder's contact, a waiting row's counterparty,
// a trusted adult's People record). merge.test.ts proves the store round trip.

import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import { relinkData, relinkPerson, unrelink, restorePatch, RELINK_TYPES } from "./relink";

describe("relinkData", () => {
  it("moves a task's personId and a reminder linked to the contact, and leaves the rest of the reminder alone", () => {
    const d = { text: "Call", personId: "a", reminder: { time: "09:00", linkedItem: { type: "contact", id: "a", label: "Mom" } } };
    expect(relinkData("task", d, "a", "b")).toEqual({ text: "Call", personId: "b", reminder: { time: "09:00", linkedItem: { type: "contact", id: "b", label: "Mom" } } });
  });

  it("a reminder linked to a task with the same id is not a person, and is not moved", () => {
    const d = { text: "Call", reminder: { time: "09:00", linkedItem: { type: "task", id: "a" } } };
    expect(relinkData("task", d, "a", "b")).toBeNull();
  });

  it("moves waiting.contactId and health_trusted_adult.personId", () => {
    expect(relinkData("waiting", { title: "W", contactId: "a" }, "a", "b")).toEqual({ title: "W", contactId: "b" });
    expect(relinkData("waiting", { title: "W", contactId: "z" }, "a", "b")).toBeNull();
    expect(relinkData("health_trusted_adult", { name: "Linda", phone: "1", personId: "a", at: 1 }, "a", "b"))
      .toEqual({ name: "Linda", phone: "1", personId: "b", at: 1 });
    expect(relinkData("health_trusted_adult", { name: "Linda", phone: "1", at: 1 }, "a", "b")).toBeNull();
  });

  it("RELINK_TYPES names the two new kinds", () => {
    expect(RELINK_TYPES).toEqual(["task", "note", "decision_record", "strand", "waiting", "health_trusted_adult"]);
  });
});

describe("relinkPerson and unrelink over the store", () => {
  it("rewrites the new kinds and puts them back", async () => {
    const store = new Store(new InMemoryAdapter());
    const w = await store.create("u", "waiting", { title: "Transcript", contactId: "a" } as unknown as ItemData);
    const h = await store.create("u", "health_trusted_adult", { name: "Linda", phone: "1", personId: "a", at: 1 } as unknown as ItemData);
    const t = await store.create("u", "task", { text: "Call", reminder: { time: "09:00", linkedItem: { type: "contact", id: "a" } } } as unknown as ItemData);
    const moved = await relinkPerson(store, "u", "a", "b");
    expect(moved.map((r) => r.id).sort()).toEqual([w, h, t].sort());
    const read = async (id: string) => (await store.read("u", id))!.data as Record<string, unknown>;
    expect((await read(w)).contactId).toBe("b");
    expect((await read(h)).personId).toBe("b");
    expect(((await read(t)).reminder as { linkedItem: { id: string } }).linkedItem.id).toBe("b");
    await unrelink(store, "u", moved);
    expect((await read(w)).contactId).toBe("a");
    expect((await read(h)).personId).toBe("a");
    expect(((await read(t)).reminder as { linkedItem: { id: string } }).linkedItem.id).toBe("a");
  });

  it("restorePatch clears a key the change added", () => {
    expect(restorePatch({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: undefined });
  });
});
