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
