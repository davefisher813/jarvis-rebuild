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
