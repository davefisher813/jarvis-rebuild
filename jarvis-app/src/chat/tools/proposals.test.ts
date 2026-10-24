import { describe, it, expect, vi } from "vitest";
import { APPROVAL_MS, CANCEL_LABEL, ProposalStore, cardLines, confirmLabel, contentHash, plain, subjectOf, type ProposalContent } from "./proposals";

// WHAT THE PERSON IS ASKED TO APPROVE (chat box order, 2026-10-24): "hash-bound, 5-minute expiry, single use", and "any edit invalidates".

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
function setup() {
  const c = clock();
  let n = 0;
  return { c, store: new ProposalStore(c.now, () => `p${++n}`) };
}

const addTask: ProposalContent = { kind: "create_task", text: "Call the plumber", due: "2026-10-30", priority: "high", personId: "m1", personName: "Marco" };
const moveTask: ProposalContent = {
  kind: "update_task", taskId: "t1", title: "Call the plumber",
  basis: { text: "Call the plumber", due: "2026-10-29", done: false, priority: null },
  change: { due: "2026-10-30" },
};
const decision: ProposalContent = { kind: "capture_decision", decision: "Use Ridgeline for the roof", why: "Best warranty", ruledOut: "Summit Roofing" };

describe("opening a proposal", () => {
  it("binds it to a hash of exactly its content, with five minutes to live", async () => {
    const { store, c } = setup();
    const p = await store.open("create_task", addTask);
    expect(p.hash).toBe(await contentHash(addTask));
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.state).toBe("open");
    expect(p.expiresAt - p.createdAt).toBe(APPROVAL_MS);
    expect(APPROVAL_MS).toBe(5 * 60_000);
    expect(p.createdAt).toBe(c.now());
  });

  it("a different content is a different hash, and the same content is the same one however its keys were ordered", async () => {
    const a = await contentHash(addTask);
    expect(await contentHash({ ...addTask, text: "Call the plumber." })).not.toBe(a);
    expect(await contentHash({ ...addTask, due: "2026-10-31" })).not.toBe(a);
    const reordered = { personName: "Marco", personId: "m1", priority: "high", due: "2026-10-30", text: "Call the plumber", kind: "create_task" } as ProposalContent;
    expect(await contentHash(reordered)).toBe(a);
  });

  it("mints its own ids: two proposals never share one", async () => {
    const store = new ProposalStore();
    const a = await store.open("create_task", { kind: "create_task", text: "One" });
    const b = await store.open("create_task", { kind: "create_task", text: "Two" });
    expect(a.id).not.toBe(b.id);
  });

  it("lists what is on the screen, oldest first", async () => {
    const { store, c } = setup();
    const a = await store.open("create_task", addTask);
    c.advance(1000);
    const b = await store.open("capture_decision", decision);
    expect(store.list().map((p) => p.id)).toEqual([a.id, b.id]);
  });
});

describe("approving", () => {
  it("accepts the hash the card drew, once", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    const first = await store.approve(p.id, p.hash);
    expect(first.ok).toBe(true);
    expect(store.get(p.id)?.state).toBe("approved");
    expect(await store.approve(p.id, p.hash)).toEqual({ ok: false, reason: "not_open" });
  });

  it("two taps that arrive together make one change: exactly one is accepted", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    const results = await Promise.all([store.approve(p.id, p.hash), store.approve(p.id, p.hash), store.approve(p.id, p.hash)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "not_open")).toBe(true);
  });

  it("refuses a hash that is not the card's, and the proposal stays open", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    expect(await store.approve(p.id, await contentHash({ ...addTask, text: "Something else" }))).toEqual({ ok: false, reason: "changed" });
    expect(store.get(p.id)?.state).toBe("open");
    expect((await store.approve(p.id, p.hash)).ok).toBe(true);
  });

  it("refuses when the content was edited after the card was drawn, even with the old hash in hand", async () => {
    const { store } = setup();
    const p = await store.open("create_task", { ...addTask });
    (p.content as { text: string }).text = "Call the plumber and the electrician";
    expect(await store.approve(p.id, p.hash)).toEqual({ ok: false, reason: "changed" });
    expect(store.get(p.id)?.state).toBe("open");
  });

  it("an id nobody knows is gone", async () => {
    const { store } = setup();
    expect(await store.approve("nope", "abc")).toEqual({ ok: false, reason: "gone" });
  });
});

describe("five minutes", () => {
  it("a tap inside the window counts; at the five minute mark it does not", async () => {
    const { store, c } = setup();
    const p = await store.open("create_task", addTask);
    c.advance(APPROVAL_MS - 1);
    const q = await store.open("capture_decision", decision);
    c.advance(1);
    expect(await store.approve(p.id, p.hash)).toEqual({ ok: false, reason: "expired" });
    expect(store.get(p.id)?.state).toBe("expired");
    expect((await store.approve(q.id, q.hash)).ok).toBe(true);
  });

  it("an expired card can still be seen, so the person knows what it was, and can be dismissed", async () => {
    const { store, c } = setup();
    const p = await store.open("create_task", addTask);
    c.advance(APPROVAL_MS + 1);
    store.sweep();
    expect(store.list().map((x) => [x.id, x.state])).toEqual([[p.id, "expired"]]);
    expect(store.dismiss(p.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(await store.approve(p.id, p.hash)).toEqual({ ok: false, reason: "gone" });
  });

  it("an open card is never dismissed: only approved or set aside", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    expect(store.dismiss(p.id)).toBe(false);
    expect(store.get(p.id)?.state).toBe("open");
  });

  it("sweep tells subscribers once, and only when something ran out", async () => {
    const { store, c } = setup();
    const heard = vi.fn();
    store.subscribe(heard);
    await store.open("create_task", addTask);
    heard.mockClear();
    store.sweep();
    expect(heard).not.toHaveBeenCalled();
    c.advance(APPROVAL_MS);
    store.sweep();
    store.sweep();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("a newer proposal for the same thing", () => {
  it("replaces the older one, which can no longer be approved", async () => {
    const { store } = setup();
    const older = await store.open("update_task", moveTask);
    const newer = await store.open("update_task", { ...moveTask, change: { due: "2026-11-02" } });
    expect(store.get(older.id)?.state).toBe("superseded");
    expect(store.list().map((p) => p.id)).toEqual([newer.id]);
    expect(await store.approve(older.id, older.hash)).toEqual({ ok: false, reason: "superseded" });
    expect((await store.approve(newer.id, newer.hash)).ok).toBe(true);
  });

  it("two different things sit side by side", async () => {
    const { store } = setup();
    await store.open("create_task", addTask);
    await store.open("create_task", { kind: "create_task", text: "Pay the electrician" });
    await store.open("update_task", moveTask);
    await store.open("capture_decision", decision);
    expect(store.list()).toHaveLength(4);
  });

  it("the same words in another case or with extra spaces are the same thing", async () => {
    const { store } = setup();
    const a = await store.open("create_task", { kind: "create_task", text: "Call the Plumber" });
    await store.open("create_task", { kind: "create_task", text: "  call the plumber  " });
    expect(store.get(a.id)?.state).toBe("superseded");
  });
});

describe("setting a card aside, and finishing one", () => {
  it("cancel closes an open card for good", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    expect(store.cancel(p.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.cancel(p.id)).toBe(false);
    expect(await store.approve(p.id, p.hash)).toEqual({ ok: false, reason: "not_open" });
  });

  it("an approved card stays on screen, working, until the receipt is written; then it goes", async () => {
    const { store } = setup();
    const p = await store.open("create_task", addTask);
    await store.approve(p.id, p.hash);
    expect(store.list().map((x) => x.state)).toEqual(["approved"]);
    expect(store.cancel(p.id)).toBe(false);
    store.finish(p.id, true);
    expect(store.get(p.id)?.state).toBe("executed");
    expect(store.list()).toEqual([]);
  });

  it("a change that failed ends as failed, and finish does nothing to a card that was never approved", async () => {
    const { store } = setup();
    const a = await store.open("create_task", addTask);
    const b = await store.open("capture_decision", decision);
    await store.approve(a.id, a.hash);
    store.finish(a.id, false);
    store.finish(b.id, true);
    expect(store.get(a.id)?.state).toBe("failed");
    expect(store.get(b.id)?.state).toBe("open");
  });

  it("forgets spent cards an hour old, and never an open one", async () => {
    const { store, c } = setup();
    const spent = await store.open("create_task", addTask);
    store.cancel(spent.id);
    const waiting = await store.open("capture_decision", decision);
    c.advance(61 * 60_000);
    await store.open("create_task", { kind: "create_task", text: "Another" });
    expect(store.get(spent.id)).toBeUndefined();
    expect(store.get(waiting.id)?.state).toBe("open");
  });

  it("subscribers hear every change and can stop listening", async () => {
    const { store } = setup();
    const heard = vi.fn();
    const off = store.subscribe(heard);
    const p = await store.open("create_task", addTask);
    store.cancel(p.id);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    await store.open("create_task", addTask);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("what the card says", () => {
  it("a new task: the question, the exact words, then each fact on its own line", () => {
    expect(cardLines(addTask)).toEqual(["Add this task?", "Call the plumber", "Due Fri, Oct 30", "High Priority", "About Marco"]);
    expect(cardLines({ kind: "create_task", text: "Pay rent" })).toEqual(["Add this task?", "Pay rent"]);
  });

  it("a change to a task: what it is now, then only what would change, with what it was", () => {
    expect(cardLines(moveTask)).toEqual(["Change this task?", "Call the plumber", "Due Fri, Oct 30 (was Thu, Oct 29)"]);
    expect(cardLines({ ...moveTask, change: { done: true } })).toEqual(["Change this task?", "Call the plumber", "Mark it done"]);
    expect(cardLines({ ...moveTask, change: { due: null } })).toEqual(["Change this task?", "Call the plumber", "Clear the due date (was Thu, Oct 29)"]);
    const undated: ProposalContent = {
      kind: "update_task", taskId: "t1", title: "Call the plumber",
      basis: { text: "Call the plumber", due: null, done: false, priority: null },
      change: { due: "2026-11-02", priority: "low", text: "Call the plumber about the leak" },
    };
    expect(cardLines(undated)).toEqual(["Change this task?", "Call the plumber", "New words: Call the plumber about the leak", "Due Mon, Nov 2", "Low Priority"]);
    expect(cardLines({ ...moveTask, change: { priority: null } })).toContain("Clear the priority");
  });

  it("a decision: the words, the reason and what it was chosen over", () => {
    expect(cardLines(decision)).toEqual(["Save this decision?", "Use Ridgeline for the roof", "Why: Best warranty", "Instead of: Summit Roofing"]);
    expect(cardLines({ kind: "capture_decision", decision: "Go with the blue one" })).toEqual(["Save this decision?", "Go with the blue one"]);
  });

  it("shows long words whole and never joins facts with a dot: the catalog draws those as spans, and a card holds none", () => {
    const long = "Call the plumber about the leak under the kitchen sink and the second bathroom, and ask about the water heater too " + "x".repeat(300);
    const lines = cardLines({ kind: "create_task", text: long, due: "2026-10-30", priority: "low" });
    expect(lines[1]).toBe(long);
    for (const c of [addTask, moveTask, decision]) for (const l of cardLines(c)) expect(l.includes(" · "), l).toBe(false);
  });

  it("a title that came from a stranger cannot forge a line of the card or hide anything in it", () => {
    const hostile: ProposalContent = {
      kind: "update_task", taskId: "t1", title: "Pay invoice\nDue Tue, Dec 1\r\nHigh Priority",
      basis: { text: "x", due: null, done: false, priority: null }, change: { done: true },
    };
    expect(cardLines(hostile)).toEqual(["Change this task?", "Pay invoice Due Tue, Dec 1 High Priority", "Mark it done"]);
    expect(subjectOf(hostile)).toBe("Pay invoice Due Tue, Dec 1 High Priority");
    const named: ProposalContent = { kind: "create_task", text: "Call", personId: "m1", personName: "Marco\n\u202EEvil" };
    expect(cardLines(named)).toEqual(["Add this task?", "Call", "About Marco Evil"]);
  });

  it("plain words are visible, on one line, and trimmed", () => {
    expect(plain("  a\u200Bb\u00ADc \n\t d\u202Ee\uFEFF ")).toBe("abc de");
    expect(plain("")).toBe("");
    expect(plain("Call the plumber")).toBe("Call the plumber");
  });

  it("names the button for what it does, in Title Case, and the other one Not Now", () => {
    expect(confirmLabel(addTask)).toBe("Add Task");
    expect(confirmLabel(decision)).toBe("Save Decision");
    expect(confirmLabel(moveTask)).toBe("Move Task");
    expect(confirmLabel({ ...moveTask, change: { due: null } })).toBe("Clear Date");
    expect(confirmLabel({ ...moveTask, change: { done: true } })).toBe("Mark Done");
    expect(confirmLabel({ ...moveTask, change: { done: true, due: "2026-11-02" } })).toBe("Change Task");
    expect(confirmLabel({ ...moveTask, change: { text: "New" } })).toBe("Change Task");
    expect(CANCEL_LABEL).toBe("Not Now");
  });

  it("says what a change is about in a few words", () => {
    expect(subjectOf(addTask)).toBe("Call the plumber");
    expect(subjectOf(moveTask)).toBe("Call the plumber");
    expect(subjectOf(decision)).toBe("Use Ridgeline for the roof");
  });
});
