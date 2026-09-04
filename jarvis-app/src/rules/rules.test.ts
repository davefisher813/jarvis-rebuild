// @vitest-environment jsdom
// LAWS (Uncertainty Protocol, addendum item 25 + unification law):
// - two identical corrections create a rule; one does not; a wobble resets
// - a rule announces itself exactly once
// - one contradiction kills a rule instantly
// - deleting the row fully reverts the behavior (resolve answers null)
// - a rule never generalizes past its scope

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { LearnedRulesService } from "./LearnedRulesService";
import { ENTITY_LEARNED_RULE } from "./types";
import { subscribeToast, hideToast, type ToastState } from "../shared/toast";

const U = "user1";

function rig() {
  const store = new Store(new InMemoryAdapter());
  const svc = new LearnedRulesService(store, U);
  return { store, svc };
}

beforeEach(() => {
  localStorage.clear();
  hideToast();
});

describe("law: two identical corrections make a rule, one does not", () => {
  it("the first correction creates nothing", async () => {
    const { svc } = rig();
    const made = await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "You refiled practice to Elite Squad");
    expect(made).toBeNull();
    expect(await svc.resolve("capture.category", "practice")).toBeNull();
  });

  it("the second identical correction creates the rule with both pieces of evidence", async () => {
    const { svc } = rig();
    await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "You refiled practice to Elite Squad");
    const made = await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "You refiled practice to Elite Squad again");
    expect(made).not.toBeNull();
    expect(made!.data.evidence.length).toBe(2);
    const found = await svc.resolve("capture.category", "practice");
    expect(found!.data.to).toBe("elite-squad");
  });

  it("a differing correction resets the pattern instead of averaging it", async () => {
    const { svc } = rig();
    await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "e1");
    const made = await svc.recordCorrection("alias", "capture.category", "practice", "orgA", "e2");
    expect(made).toBeNull();
    expect(await svc.resolve("capture.category", "practice")).toBeNull();
    // The new signal needs its own pair.
    const second = await svc.recordCorrection("alias", "capture.category", "practice", "orgA", "e3");
    expect(second).not.toBeNull();
  });
});

describe("law: rules announce once, die on one contradiction, and delete cleanly", () => {
  async function makeRule(svc: LearnedRulesService) {
    await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "e1");
    return (await svc.recordCorrection("alias", "capture.category", "practice", "elite-squad", "e2"))!;
  }

  it("first use announces, second use is silent", async () => {
    const { svc } = rig();
    const rule = await makeRule(svc);
    const toasts: (ToastState | null)[] = [];
    const un = subscribeToast((t) => toasts.push(t));
    await svc.announceIfFirstUse(rule);
    const announced = toasts.filter(Boolean).length;
    expect(announced).toBe(1);
    const again = (await svc.resolve("capture.category", "practice"))!;
    await svc.announceIfFirstUse(again);
    expect(toasts.filter(Boolean).length).toBe(announced);
    un();
  });

  it("one contradicting correction kills the rule instantly", async () => {
    const { svc } = rig();
    await makeRule(svc);
    await svc.recordCorrection("alias", "capture.category", "practice", "orgA", "contradiction");
    expect(await svc.resolve("capture.category", "practice")).toBeNull();
  });

  // RECORD-ONLY MODE (Dave's decision, 2026-08-24). Corrections are observed
  // and rules are created so they can be judged in What JARVIS Learned, and
  // nothing calls resolve(), so no rule ever acts. That means no rule is ever
  // announced, and a contradiction toast about a rule he was never told
  // existed would be the same lie as the strand toast that said the Brain was
  // full when it was not.
  it("a rule that was never announced dies quietly", async () => {
    const { svc } = rig();
    await makeRule(svc);
    const seen: (ToastState | null)[] = [];
    const un = subscribeToast((t) => seen.push(t));
    await svc.recordCorrection("alias", "capture.category", "practice", "orgA", "contradiction");
    expect(seen.filter(Boolean)).toEqual([]);
    un();
  });

  // And the announcement still means something: once he HAS been told, taking
  // it back out loud is the honest thing.
  it("a rule he was told about says so when it dies", async () => {
    const { svc } = rig();
    const rule = await makeRule(svc);
    await svc.announceIfFirstUse(rule);
    hideToast();
    const seen: (ToastState | null)[] = [];
    const un = subscribeToast((t) => seen.push(t));
    await svc.recordCorrection("alias", "capture.category", "practice", "orgA", "contradiction");
    expect(seen.filter(Boolean).map((t) => t!.message).join(" ")).toMatch(/Forgot the rule/);
    un();
  });

  it("deleting the row fully reverts the behavior", async () => {
    const { svc, store } = rig();
    const rule = await makeRule(svc);
    await svc.delete(rule.id);
    expect(await svc.resolve("capture.category", "practice")).toBeNull();
    // And the row is really gone, not soft-hidden.
    const rows = await store.listForUser(U, ENTITY_LEARNED_RULE);
    expect(rows.length).toBe(0);
  });

  it("a rule never generalizes past its scope", async () => {
    const { svc } = rig();
    await makeRule(svc);
    expect(await svc.resolve("capture.category", "practice")).not.toBeNull();
    expect(await svc.resolve("some.other.scope", "practice")).toBeNull();
    expect(await svc.resolve("capture.category", "rehearsal")).toBeNull();
  });
});

// S4-Q26 (2026-09-04): "the plan cap never becomes a rule you can delete."
// create() is the one-tap path: a person declaring a rule outright, not
// JARVIS inferring one from a pair of corrections.
describe("law: create() is one tap, one step, idempotent, and reverts on delete", () => {
  it("creates the row on the very first call, no second observation needed", async () => {
    const { svc } = rig();
    expect(await svc.resolve("plan.cap", "day")).toBeNull();
    const rule = await svc.create("tuning", "plan.cap", "day", "3", "Chosen from the monthly report");
    expect(rule.data.to).toBe("3");
    expect(rule.data.evidence).toEqual(["Chosen from the monthly report"]);
    expect((await svc.resolve("plan.cap", "day"))!.id).toBe(rule.id);
  });

  it("re-tapping an offer that already made its rule returns the existing row, not a duplicate", async () => {
    const { store, svc } = rig();
    const first = await svc.create("tuning", "plan.cap", "day", "3", "e1");
    const second = await svc.create("tuning", "plan.cap", "day", "3", "e2");
    expect(second.id).toBe(first.id);
    const rows = await store.listForUser(U, ENTITY_LEARNED_RULE);
    expect(rows.length).toBe(1);
  });

  it("deleting a create()d row genuinely reverts it, same as any other rule", async () => {
    const { svc } = rig();
    const rule = await svc.create("tuning", "plan.cap", "day", "3", "e1");
    await svc.delete(rule.id);
    expect(await svc.resolve("plan.cap", "day")).toBeNull();
  });

  // Pre-announced: the tap's own toast already said what happened, in words
  // specific to that offer. A later announceIfFirstUse must be a genuine
  // no-op, not a second, generic "New rule" toast on top of it.
  it("is born already announced, so a later read never re-announces it", async () => {
    const { svc } = rig();
    const rule = await svc.create("tuning", "plan.cap", "day", "3", "e1");
    expect(rule.data.announced).toBe(true);
    const seen: (ToastState | null)[] = [];
    const un = subscribeToast((t) => seen.push(t));
    await svc.announceIfFirstUse(rule);
    expect(seen.filter(Boolean)).toEqual([]);
    un();
  });
});
