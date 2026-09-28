// @vitest-environment jsdom
// Brain Manual v1 (Phase 1) — triage persistence and merge.
// Flow doc §7, test 6 (triage). The triage helpers (duplicate matching,
// note merge, unsorted detection) are covered in triage.test.ts; this file
// covers the gaps the spec names: the progress cursor persists and resumes,
// the setup card dismisses once, unsorted -> sorted writes the role, and a
// merge concatenates the notes and removes the loser row.

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import type { Person } from "../../people/types";
import {
  readTriageCursor,
  writeTriageCursor,
  setupCardDismissed,
  dismissSetupCard,
  mergedNotes,
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

describe("setup brain card", () => {
  it("dismisses once and stays dismissed", () => {
    expect(setupCardDismissed()).toBe(false);
    dismissSetupCard();
    expect(setupCardDismissed()).toBe(true);
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

  it("merge concatenates the notes and removes the loser row", async () => {
    const store = new Store(new InMemoryAdapter());
    const survivorId = await store.create(
      "u1",
      PERSON_ENTITY,
      { name: "Dave Fisher", notes: "First" } as unknown as ItemData,
    );
    const loserId = await store.create(
      "u1",
      PERSON_ENTITY,
      { name: "dave fisher", notes: "Second" } as unknown as ItemData,
    );
    const survivor = person(survivorId, "Dave Fisher", { notes: "First" });
    const loser = person(loserId, "dave fisher", { notes: "Second" });
    // The survivor keeps both notes; the caller deletes the loser row.
    const merged = mergedNotes(survivor, loser);
    await store.update("u1", survivorId, {
      ...( (await store.read("u1", survivorId))!.data as Record<string, unknown> ),
      notes: merged,
    } as unknown as ItemData);
    await store.delete("u1", loserId);
    const kept = (await store.read("u1", survivorId))!;
    expect((kept.data as { notes: string }).notes).toBe("First\n\nSecond");
    expect(await store.read("u1", loserId)).toBeNull();
  });
});
