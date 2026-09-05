import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { PeopleService } from "./PeopleService";
import { personInitials, slotForName } from "./types";

describe("PeopleService", () => {
  it("creates, lists by group, updates, removes", async () => {
    const svc = new PeopleService(new Store(new InMemoryAdapter()), "u1");
    const id = await svc.create({ name: "Sam Rivera", group: "inner_circle", relationship: "Partner" });
    await svc.create({ name: "Dev Kapoor", group: "contacts" });
    expect((await svc.list("inner_circle")).length).toBe(1);
    expect((await svc.list()).length).toBe(2);
    await svc.update(id!, { notes: "Prefers texts" });
    expect((await svc.get(id!))?.data.notes).toBe("Prefers texts");
    await svc.remove(id!);
    expect((await svc.list("inner_circle")).length).toBe(0);
  });

  it("rejects an empty name", async () => {
    const svc = new PeopleService(new Store(new InMemoryAdapter()), "u1");
    expect(await svc.create({ name: "  ", group: "contacts" })).toBeNull();
  });

  it("derives initials and a stable color", () => {
    expect(personInitials("Sam Rivera")).toBe("SR");
    expect(slotForName("Sam Rivera")).toBe(slotForName("Sam Rivera"));
  });
});

// BRAIN-F-01 / SCHED-F-01 (2026-09-05): the edit sheet clears a fact with
// `x || undefined`, which never reached Supabase (JSON drops the key), so a
// removed phone or birthday came back on the next refresh. The in-memory
// adapter now merges the way the server does; this proves the clears land.
describe("BRAIN-F-01: a person's cleared facts leave the row", () => {
  it("removing phone, email, birthday, notes and areas removes the keys", async () => {
    const svc = new PeopleService(new Store(new InMemoryAdapter()), "u1");
    const id = (await svc.create({ name: "Sam Rivera", group: "contacts", phone: "555-1234", email: "sam@example.com", birthday: "1990-04-02", notes: "Prefers texts", categoryIds: ["c1"] }))!;
    await svc.update(id, { name: "Sam Rivera", phone: undefined, email: undefined, birthday: undefined, notes: undefined, categoryIds: undefined });
    const d = (await svc.get(id))!.data;
    for (const k of ["phone", "email", "birthday", "notes", "categoryIds"]) {
      expect(Object.prototype.hasOwnProperty.call(d, k), `${k} should be gone`).toBe(false);
    }
    expect(d.name).toBe("Sam Rivera");
    expect(d.group).toBe("contacts");
  });
});
