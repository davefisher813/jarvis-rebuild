import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import type { Person, PersonData } from "../../people/types";
import { PeopleService } from "../../people/PeopleService";
import { restorePatch } from "../../people/relink";
import { duplicatesOf, mergedPersonData } from "./merge";

// Brain Manual v1 contact merge (fixed 2026-09-28): never a name alone,
// every field kept, every link moved, and Undo puts all of it back.

const person = (id: string, data: Partial<PersonData> & { name: string }): Person =>
  ({ id, data: { group: "contacts", ...data } } as Person);

describe("duplicatesOf", () => {
  it("never matches on a name alone", () => {
    const a = person("1", { name: "John Smith" });
    const b = person("2", { name: "John Smith" });
    expect(duplicatesOf(a, [a, b])).toEqual([]);
  });

  it("matches on a shared email or phone, in either shape", () => {
    const a = person("1", { name: "John Smith", email: "John@Acme.com" });
    const b = person("2", { name: "J. Smith", emails: [{ value: "john@acme.com" }] });
    const c = person("3", { name: "Johnny", phones: [{ value: "(203) 555-0101" }] });
    const d = person("4", { name: "John S", phone: "203-555-0101", email: "other@x.com" });
    expect(duplicatesOf(a, [a, b, c, d]).map((p) => p.id)).toEqual(["2"]);
    expect(duplicatesOf(c, [a, b, c, d]).map((p) => p.id)).toEqual(["4"]);
  });
});

describe("mergedPersonData keeps every field", () => {
  it("unions contact methods, aliases, roles and categories; joins notes; fills gaps", () => {
    const kept = person("1", {
      name: "John Smith",
      email: "john@acme.com",
      notes: "First",
      roles: ["work"],
      categoryIds: ["c1"],
    });
    const gone = person("2", {
      name: "Johnny Smith",
      email: "john@acme.com",
      emails: [{ value: "john@acme.com" }, { value: "js@home.com" }],
      phone: "203-555-0101",
      birthday: "1980-04-02",
      aliases: ["JS"],
      notes: "Second",
      roles: ["friend", { categoryId: "c2", role: "Coach" }],
      categoryIds: ["c1", "c2"],
      roleNote: "Met at the game",
    });
    const m = mergedPersonData(kept, gone);
    expect(m.name).toBe("John Smith");
    expect(m.emails?.map((e) => e.value)).toEqual(["john@acme.com", "js@home.com"]);
    expect(m.phone).toBe("203-555-0101");
    expect(m.birthday).toBe("1980-04-02");
    expect(m.aliases).toEqual(["JS", "Johnny Smith"]);
    expect(m.notes).toBe("First\n\nSecond");
    expect(m.roles).toEqual(["work", "friend", { categoryId: "c2", role: "Coach" }]);
    expect(m.categoryIds).toEqual(["c1", "c2"]);
    expect((m as { roleNote?: string }).roleNote).toBe("Met at the game");
  });

  it("the kept row's own value wins where both have one", () => {
    const m = mergedPersonData(
      person("1", { name: "A", birthday: "1980-01-01", relationship: "Brother" }),
      person("2", { name: "A", birthday: "1981-01-01", relationship: "Friend" }),
    );
    expect(m.birthday).toBe("1980-01-01");
    expect(m.relationship).toBe("Brother");
  });
});

describe("relink and Undo", () => {
  it("moves every link to the kept contact, and Undo puts it all back", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new PeopleService(store, "u1");
    const keptId = (await svc.create({ name: "John Smith", group: "contacts", email: "john@acme.com" }))!;
    const goneId = (await svc.create({ name: "Johnny", group: "contacts", email: "john@acme.com", phone: "203-555-0101" }))!;
    const task = await store.create("u1", "task", { text: "Call John", personId: goneId } as unknown as ItemData);
    const note = await store.create("u1", "note", { title: "N", connections: [{ id: "x", kind: "person", label: "Johnny", targetId: goneId }] } as unknown as ItemData);
    const dec = await store.create("u1", "decision_record", { decision: "D", linkedType: "person", linkedId: goneId, links: [{ type: "person", id: goneId, label: "Johnny" }] } as unknown as ItemData);
    const strand = await store.create("u1", "strand", { text: "S", link: { entityType: "person", entityId: goneId } } as unknown as ItemData);
    const other = await store.create("u1", "task", { text: "Unrelated", personId: keptId } as unknown as ItemData);

    const kept = (await svc.get(keptId))!;
    const gone = (await svc.get(goneId))!;
    const before = kept.data as unknown as Record<string, unknown>;
    const merged = mergedPersonData(kept, gone) as unknown as Record<string, unknown>;
    await svc.update(keptId, restorePatch(merged, before) as unknown as Partial<PersonData>);
    const moved = await svc.relink(goneId, keptId);
    await svc.remove(goneId);

    expect(moved.map((r) => r.id).sort()).toEqual([task, note, dec, strand].sort());
    const read = async (id: string) => (await store.read("u1", id))!.data as Record<string, unknown>;
    expect((await read(task)).personId).toBe(keptId);
    expect(((await read(note)).connections as { targetId: string }[])[0]!.targetId).toBe(keptId);
    expect((await read(dec)).linkedId).toBe(keptId);
    expect(((await read(dec)).links as { id: string }[])[0]!.id).toBe(keptId);
    expect(((await read(strand)).link as { entityId: string }).entityId).toBe(keptId);
    expect((await read(other)).personId).toBe(keptId);
    expect((await svc.get(keptId))!.data.phone).toBe("203-555-0101");
    expect(await svc.get(goneId)).toBeNull();

    // Undo: the other row back under its own id, links back, kept row as it was.
    await svc.create(gone.data, goneId);
    await svc.unrelink(moved);
    await svc.update(keptId, restorePatch(before, merged) as unknown as Partial<PersonData>);
    expect((await svc.get(goneId))!.data.name).toBe("Johnny");
    expect((await read(task)).personId).toBe(goneId);
    expect(((await read(note)).connections as { targetId: string }[])[0]!.targetId).toBe(goneId);
    expect((await read(dec)).linkedId).toBe(goneId);
    expect(((await read(strand)).link as { entityId: string }).entityId).toBe(goneId);
    const back = (await svc.get(keptId))!.data;
    expect(back.phone).toBeUndefined();
    expect(back.aliases).toBeUndefined();
    expect(back.email).toBe("john@acme.com");
  });
});
