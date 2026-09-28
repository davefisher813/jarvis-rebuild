// @vitest-environment jsdom
// Brain Manual v1 (Phase 1): triage persistence.
// Flow doc §7, test 6 (triage). The progress cursor persists and resumes,
// and unsorted -> sorted writes the role. The merge is merge.test.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import type { Person } from "../../people/types";
import {
  readTriageCursor,
  writeTriageCursor,
  isUnsorted,
} from "./triage";
import { BrainMemoryService } from "../../ai/brainMemoryService";
import { PERSON_ENTITY } from "../../ai/brainMemory";

beforeEach(() => {
  localStorage.clear();
});

const person = (
  id: string,
  name: string,
  data: Record<string, unknown> = {},
): Person => ({ id, data: { name, group: "contacts", ...data } } as Person);

describe("triage progress cursor", () => {
  it("round-trips the id of the next card to show", () => {
    writeTriageCursor("person-3");
    expect(readTriageCursor()).toBe("person-3");
  });

  it("null clears the cursor", () => {
    writeTriageCursor("person-3");
    writeTriageCursor(null);
    expect(readTriageCursor()).toBeNull();
  });

  it("a missing cursor means start at the first unsorted card", () => {
    expect(readTriageCursor()).toBeNull();
  });

  it("resume skips cards already sorted past the cursor", () => {
    const cards = [person("1", "A"), person("2", "B"), person("3", "C")];
    writeTriageCursor("2");
    const cursor = readTriageCursor();
    const next = cards.slice(cards.findIndex((c) => c.id === cursor) + 1);
    expect(next.map((c) => c.id)).toEqual(["3"]);
  });
});

describe("triage writes", () => {
  const seedUnsorted = async (store: Store) =>
    store.create("u1", PERSON_ENTITY, {
      name: "Sam Rivera",
      triageState: "unsorted",
      source: "email",
    } as unknown as ItemData);

  it("unsorted -> sorted writes the role and clears unsorted", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BrainMemoryService(store, "u1");
    const id = await seedUnsorted(store);
    expect(isUnsorted(person(id, "Sam Rivera", { triageState: "unsorted" }))).toBe(true);
    expect(await svc.triagePerson(id, ["work"], "Met at the game", "email")).toBe(true);
    const row = (await store.read("u1", id))!;
    const data = row.data as { roles: string[]; triageState: string; roleNote: string };
    expect(data.roles).toContain("work");
    expect(data.triageState).toBe("sorted");
    expect(data.roleNote).toBe("Met at the game");
  });
});
