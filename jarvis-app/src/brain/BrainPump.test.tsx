// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Store, InMemoryAdapter } from "@core";
import { PeopleService } from "../people/PeopleService";
import { readConsolidation } from "./nightly";
import type { WindowRow } from "./window";

// THE DAY'S PASS DECIDES WITH EVERY INPUT, OR IT DOES NOT DECIDE (2026-09-06).
//
// BrainPump called brainMoments(rows, list) with no people argument, so the
// one pass that actually decides the day ran the two people derivations
// against an empty Contacts list, every day, forever. This drives the pump's
// own path: a real PeopleService, the real peopleForDerivation assembly, a
// real window, and the consolidation it writes.

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("../auth/supabaseClient", () => ({ supabase: null }));
vi.mock("./window", async (orig) => {
  const real = await orig<typeof import("./window")>();
  return { ...real, readWindow: async () => h.rows };
});

let people: PeopleService;
vi.mock("../data/NotesProvider", () => ({
  useOptionalStrands: () => ({ list: async () => [] }),
  useOptionalPeople: () => people,
}));

// Imported after the mocks so the component picks them up.
const { default: BrainPump } = await import("./BrainPump");

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "email.handled", day: "2026-08-20", h: 9,
  category: null, n: null, flag: null, kind: null, entity_id: null, ...over,
});

// Handled mail with one person, spread so no 3-hour stretch holds 40 percent
// of it: people_rhythm qualifies and the email band deliberately does not.
const withPerson = (id: string, n: number): WindowRow[] =>
  Array.from({ length: n }, (_, i) =>
    row({ entity_id: id, h: (i * 2) % 24, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

// Ten task completions inside one band, which is the shape completion_window
// wants: something for the pass to say that has nothing to do with Contacts.
const completions = (): WindowRow[] =>
  Array.from({ length: 10 }, (_, i) =>
    row({ type: "task.completed", h: 9, day: `2026-08-${String(i + 1).padStart(2, "0")}` }));

async function pump(): Promise<string[]> {
  render(<BrainPump dayKey="test" />);
  await waitFor(() => expect(readConsolidation()).not.toBeNull());
  return readConsolidation()!.keys;
}

beforeEach(() => {
  localStorage.clear();
  people = new PeopleService(new Store(new InMemoryAdapter()), "u-pump");
  h.rows = [];
});

describe("the day's pass decides with Contacts in hand", () => {
  it("consolidates a people derivation the log alone could never name", async () => {
    // The log carries person ids and nothing else, by design. Without the
    // Contacts list the pass has no name to put to this person, so it wrote a
    // day's decision that could not contain the fact.
    const id = await people.create({ name: "Marco Reyes", group: "contacts" });
    h.rows = withPerson(id!, 12);
    expect(await pump()).toContain("people_rhythm");
  });

  it("a people fact is not locked out by a day that had something else to say", async () => {
    // The damaging half. consolidate() refuses to record an empty set, so the
    // people derivations survived on days the pass found NOTHING at all. The
    // moment any other detector spoke, the day's keys were written without
    // them and readChosen (nightly.ts:123) only ever maps keys already
    // stored, so Today passing its own people list changed nothing until
    // tomorrow.
    const id = await people.create({ name: "Marco Reyes", group: "contacts" });
    h.rows = [...completions(), ...withPerson(id!, 12)];
    const keys = await pump();
    expect(keys).toContain("completion_window");
    expect(keys).toContain("people_rhythm");
  });

  it("somebody already labelled needs no proposal, so the day stays quiet", async () => {
    // The guard inside derivePeopleRhythm, reached through the pump: this is
    // what proves the list arrives with its labels attached and not as bare
    // names.
    const id = await people.create({ name: "Marco Reyes", group: "contacts", relationship: "Work" });
    h.rows = withPerson(id!, 12);
    render(<BrainPump dayKey="test" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(readConsolidation()).toBeNull();
  });
});
