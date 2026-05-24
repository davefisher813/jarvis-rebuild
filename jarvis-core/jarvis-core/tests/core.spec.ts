import { beforeAll, describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../src/core/inMemoryAdapter.js";
import { Store } from "../src/core/store.js";
import { REQUIREMENTS, STEPS, type Ctx } from "../src/core/spec.js";

// These tests are generated from the single source of truth (spec.ts), which
// is a 1:1 port of the approved harness steps. Same definitions drive the
// tap-through harness and these automated tests, so they cannot drift.

describe("Core Data Model: approved behavior (single source: spec.ts)", () => {
  // One shared store and context, run in order, exactly like the harness:
  // the behavior is stateful (record ids carry forward across steps).
  const store = new Store(new InMemoryAdapter());
  const ctx: Ctx = {};

  // Generate one ordered test per approved step.
  STEPS.forEach((step, i) => {
    const n = String(i + 1).padStart(2, "0");
    it(`${n} [${step.covers.join(",")}] ${step.label}`, async () => {
      const r = await step.run(store, ctx);
      expect(r.ok, r.msg).toBe(true);
    });
  });
});

describe("Coverage: every requirement is exercised by a step", () => {
  const covered = new Set(STEPS.flatMap((s) => s.covers));
  REQUIREMENTS.forEach((req) => {
    it(`${req.id} is covered: ${req.text}`, () => {
      expect(covered.has(req.id), `no step covers ${req.id}`).toBe(true);
    });
  });
});

// The two historical bugs each keep a dedicated, self-contained test that must
// stay green forever (TEST_PROCEDURE.md). They do not depend on the sequence
// above; each builds its own minimal state.
describe("Permanent guardian: tombstone resurrection cannot happen (D4/D5)", () => {
  let adapter: InMemoryAdapter;
  let store: Store;

  beforeAll(() => {
    adapter = new InMemoryAdapter();
    store = new Store(adapter);
  });

  it("a hard-deleted record never returns after a fresh read", async () => {
    const id = await store.create("U", "test", { label: "Doomed" });
    expect((await store.read("U", id)) !== null, "should exist before delete").toBe(true);

    await store.delete("U", id);

    expect(await store.read("U", id), "owner read must be null").toBeNull();
    expect((await store.listForUser("U")).length, "owner list must be empty").toBe(0);
    expect(adapter.snapshotCount(), "no row anywhere: there is no tombstone").toBe(0);
  });
});

describe("Permanent guardian: offline edits survive reconnect with no loss (D8)", () => {
  it("an edit made offline applies cleanly on reconnect", async () => {
    const store = new Store(new InMemoryAdapter());
    const id = await store.create("U", "test", { label: "Original" });

    await store.update("U", id, { label: "Online Edit" });
    expect((await store.read("U", id))?.data.label).toBe("Online Edit");

    store.goOffline();
    const res = await store.update("U", id, { label: "Offline Edit" });
    expect(res, "offline update is held, not applied").toBe("queued");
    expect((await store.read("U", id))?.data.label, "still old value while offline").toBe(
      "Online Edit"
    );
    expect(store.queueLen(), "exactly one queued op").toBe(1);

    await store.reconnect();
    expect((await store.read("U", id))?.data.label, "offline edit applied").toBe("Offline Edit");
    expect(store.queueLen(), "queue drained, nothing lost").toBe(0);
  });
});
