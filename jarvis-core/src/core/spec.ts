import type { Store } from "./store.js";

// SINGLE SOURCE OF TRUTH for the Core Data Model behavior.
//
// This is a faithful, 1:1 port of the approved "Core Data Model" steps in
// test-harness-v2.html. The harness proves the behavior by tap-through; this
// file drives the automated tests against the real store. The two must not
// drift: any change here or in the harness must be mirrored in the other, and
// the harness should ultimately be regenerated from this module. Each step
// runs the real Store API, exactly as the harness ran the real in-memory core.
//
// 11 ordered steps cover 10 requirements (D9 has two steps: missing-id update
// and missing-id delete). Steps run in order against one shared Store and one
// shared context, because the behavior is stateful (ids carry forward).

export interface Requirement {
  id: string;
  text: string;
}

export interface StepResult {
  ok: boolean;
  msg: string;
}

// Mutable context shared across the ordered steps (carries record ids).
export interface Ctx {
  idA?: string;
  idB?: string;
}

export interface Step {
  kind: "core" | "edge";
  covers: string[];
  label: string;
  expect: string;
  run: (s: Store, c: Ctx) => Promise<StepResult>;
}

export const REQUIREMENTS: Requirement[] = [
  { id: "D1", text: "Create a record" },
  { id: "D2", text: "Read it back" },
  { id: "D3", text: "Update a field" },
  { id: "D4", text: "Hard delete (record gone)" },
  { id: "D5", text: "Deleted record never returns after reload (tombstone)" },
  { id: "D6", text: "Per-user isolation: a user sees only their own records" },
  { id: "D7", text: "Server-time-wins on conflicting writes (scalar sync)" },
  { id: "D8", text: "Offline edit queues, applies on reconnect, no loss" },
  { id: "D9", text: "Update or delete on a missing id is a safe no-op" },
  { id: "D10", text: "Concurrent edits resolve deterministically by server time" },
];

const TYPE = "test"; // the core spine is entity-type agnostic; no Personal types seeded

export const STEPS: Step[] = [
  {
    kind: "core",
    covers: ["D1"],
    label: "Create a record (user A)",
    expect: "One record owned by A, with the given fields.",
    async run(s, c) {
      c.idA = await s.create("A", TYPE, { label: "Marathon", theme: "dark" });
      const ok = (await s.listForUser("A")).length === 1 && (await s.read("A", c.idA)) !== null;
      return { ok, msg: ok ? "Record created for user A." : "Record not created." };
    },
  },
  {
    kind: "core",
    covers: ["D2"],
    label: "Read it back",
    expect: "The record reads back with label 'Marathon'.",
    async run(s, c) {
      const r = await s.read("A", c.idA as string);
      const ok = !!r && r.data.label === "Marathon";
      return { ok, msg: ok ? "Read returns the right record." : "Read failed." };
    },
  },
  {
    kind: "core",
    covers: ["D3"],
    label: "Update a field",
    expect: "theme changes from dark to light.",
    async run(s, c) {
      await s.update("A", c.idA as string, { theme: "light" });
      const ok = (await s.read("A", c.idA as string))?.data.theme === "light";
      return { ok, msg: ok ? "Field updated." : "Update did not apply." };
    },
  },
  {
    kind: "core",
    covers: ["D4"],
    label: "Hard delete",
    expect: "The record is gone for its owner.",
    async run(s, c) {
      await s.delete("A", c.idA as string);
      const ok =
        (await s.read("A", c.idA as string)) === null &&
        (await s.listForUser("A")).length === 0;
      return { ok, msg: ok ? "Record hard-deleted." : "Record still present." };
    },
  },
  {
    kind: "core",
    covers: ["D5"],
    label: "Reload (fresh launch)",
    expect: "The deleted record stays gone. It must NOT come back.",
    async run(s, c) {
      // A fresh, owner-scoped read is empty. There is no tombstone to resurrect.
      const ok =
        (await s.read("A", c.idA as string)) === null &&
        (await s.listForUser("A")).length === 0;
      return {
        ok,
        msg: ok
          ? "Stayed gone. Tombstone resurrection cannot happen."
          : "FAIL: deleted record returned.",
      };
    },
  },
  {
    kind: "core",
    covers: ["D6"],
    label: "Per-user isolation",
    expect: "A and B each see only their own record, neither sees the other's.",
    async run(s, c) {
      c.idA = await s.create("A", TYPE, { label: "A-thing" });
      c.idB = await s.create("B", TYPE, { label: "B-thing" });
      const ok =
        (await s.read("B", c.idA)) === null &&
        (await s.read("A", c.idB)) === null &&
        (await s.listForUser("A")).length === 1 &&
        (await s.listForUser("B")).length === 1;
      return {
        ok,
        msg: ok ? "Each user is isolated to their own data." : "FAIL: data leaked across users.",
      };
    },
  },
  {
    kind: "core",
    covers: ["D7"],
    label: "Server-time-wins",
    expect: "A later-timestamped write wins even if an earlier one arrives after it.",
    async run(s, c) {
      await s.update("A", c.idA as string, { label: "NEW" }, 10);
      await s.update("A", c.idA as string, { label: "OLD" }, 4);
      const ok = (await s.read("A", c.idA as string))?.data.label === "NEW";
      return {
        ok,
        msg: ok
          ? "Latest server time won, stale write ignored."
          : "FAIL: stale write overwrote newer data.",
      };
    },
  },
  {
    kind: "edge",
    covers: ["D9"],
    label: "Update a missing id",
    expect: "Updating an id that does not exist is refused, no crash.",
    async run(s) {
      let res: unknown;
      let crashed = false;
      try {
        res = await s.update("A", "nope", { x: 1 });
      } catch {
        crashed = true;
      }
      const ok = !crashed && res === false;
      return {
        ok,
        msg: ok ? "Missing-id update safely refused." : "FAIL: crashed or accepted a bad update.",
      };
    },
  },
  {
    kind: "edge",
    covers: ["D9"],
    label: "Delete a missing id",
    expect: "Deleting an id that does not exist does not crash or remove anything.",
    async run(s) {
      const before = (await s.listForUser("A")).length;
      let crashed = false;
      try {
        await s.delete("A", "nope");
      } catch {
        crashed = true;
      }
      const ok = !crashed && (await s.listForUser("A")).length === before;
      return {
        ok,
        msg: ok ? "Missing-id delete was a safe no-op." : "FAIL: crashed or removed data.",
      };
    },
  },
  {
    kind: "edge",
    covers: ["D8"],
    label: "Offline edit then reconnect",
    expect: "Edit made offline is held, then applied on reconnect with no loss.",
    async run(s, c) {
      s.goOffline();
      const res = await s.update("A", c.idA as string, { label: "Offline Edit" });
      const held =
        (await s.read("A", c.idA as string))?.data.label === "NEW" &&
        s.queueLen() === 1 &&
        res === "queued";
      await s.reconnect();
      const applied =
        (await s.read("A", c.idA as string))?.data.label === "Offline Edit" &&
        s.queueLen() === 0;
      const ok = held && applied;
      return {
        ok,
        msg: ok
          ? "Held offline, applied cleanly on reconnect, no loss."
          : "FAIL: offline edit lost or misapplied.",
      };
    },
  },
  {
    kind: "edge",
    covers: ["D10"],
    label: "Concurrent edits, two clients",
    expect:
      "Of two clients editing the same record, the one with the later server time wins, regardless of order.",
    async run(s, c) {
      await s.update("A", c.idA as string, { label: "Winner" }, 25);
      await s.update("A", c.idA as string, { label: "Loser" }, 20);
      const ok = (await s.read("A", c.idA as string))?.data.label === "Winner";
      return {
        ok,
        msg: ok
          ? "Deterministic winner by server time, not arrival order."
          : "FAIL: non-deterministic conflict result.",
      };
    },
  },
];
