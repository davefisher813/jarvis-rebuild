import { describe, it, expect, beforeEach } from "vitest";
import { buildTrashPlan, trashSelection, undoTrashSelection, summarize, confirmCopy, receiptLine, type EnsureApi } from "./bulkMail";
import { FakeMailbox } from "./fakeMailbox";
import { refreshInboxAccount, resetInboxRefreshState } from "./inboxRefresh";
import { BATCH_MODIFY_MAX, createGoogleApi } from "../connections/google/api";
import type { ThreadRow } from "../connections/google/map";

// THE BATCH WRITE. What these prove: ids are counted as MESSAGES and chunked at
// 1000; a lost answer is read back and never re-sent; an auth failure stops
// one account and not the other; Undo touches only what this action moved;
// and nothing in this file can call the permanent-delete endpoint, because the
// API this app has does not contain one.

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
let storage: ReturnType<typeof memory>;
beforeEach(() => { resetInboxRefreshState(); storage = memory(); });

async function rowsOf(box: FakeMailbox, want = 3000): Promise<ThreadRow[]> {
  const r = await refreshInboxAccount({ userId: "u1", account: box.email }, box.api(), { storage, now: () => 1_800_000_000_000, want });
  return r.rows;
}

const ensureFor = (boxes: Record<string, FakeMailbox>, api?: (b: FakeMailbox) => ReturnType<FakeMailbox["api"]>): EnsureApi =>
  async (account) => {
    const box = boxes[account];
    if (!box) return { ok: false, message: "Google isn't connected for " + account, code: "GOOGLE_UNKNOWN_ACCOUNT" };
    return { ok: true, api: api ? api(box) : box.api() };
  };

function fill(box: FakeMailbox, n: number, prefix = "t", opts: { messages?: number } = {}) {
  for (let i = 1; i <= n; i++) box.add(prefix + i, opts);
}

describe("counting messages, chunking at 1000", () => {
  it.each([
    [0, 0], [1, 1], [999, 1], [1000, 1], [1001, 2], [2501, 3],
  ])("%i conversations of one message go in ceil(n/1000) = %i request(s)", async (n, calls) => {
    const box = new FakeMailbox();
    fill(box, n);
    const rows = n ? await rowsOf(box) : [];
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    expect(plan.messages).toBe(n);
    expect(plan.conversations).toBe(n);
    const res = await trashSelection(plan, { ensure });
    expect(res.requests).toBe(calls);
    expect(box.batchCalls).toHaveLength(calls);
    for (const c of box.batchCalls) {
      expect(c.ids.length).toBeLessThanOrEqual(BATCH_MODIFY_MAX);
      expect(c.add).toEqual(["TRASH"]);
      expect(c.remove).toEqual(["INBOX"]);
    }
    expect(summarize(res).trashed).toBe(n);
    // Every message really is in Trash and out of the inbox.
    for (const r of rows.slice(0, 5)) expect(box.labelsOf(r.lastMsgId)).toContain("TRASH");
    for (const r of rows.slice(0, 5)) expect(box.labelsOf(r.lastMsgId)).not.toContain("INBOX");
  }, 60000);

  it("counts MESSAGES, not conversations: 500 threads of 3 messages is 1500 ids and 2 requests", async () => {
    const box = new FakeMailbox();
    fill(box, 500, "m", { messages: 3 });
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure });
    expect(plan.conversations).toBe(500);
    expect(plan.messages).toBe(1500);
    const res = await trashSelection(plan, { ensure });
    expect(res.requests).toBe(2);
    expect(box.batchCalls.map((c) => c.ids.length)).toEqual([1000, 500]);
    // Never more than ceil(unique message ids / 1000) forward calls per account.
    expect(res.requests).toBeLessThanOrEqual(Math.ceil(1500 / 1000));
  }, 60000);

  it("the same conversation selected twice is moved once", async () => {
    const box = new FakeMailbox();
    fill(box, 3);
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan([...rows, ...rows, rows[0]!], { ensure, trusted: () => true });
    expect(plan.conversations).toBe(3);
    expect(plan.messages).toBe(3);
    await trashSelection(plan, { ensure });
    expect(box.batchCalls).toHaveLength(1);
    expect(new Set(box.batchCalls[0]!.ids).size).toBe(box.batchCalls[0]!.ids.length);
  });

  it("the low-level call refuses an empty list and more than 1000 ids before any request", async () => {
    let requests = 0;
    const api = createGoogleApi("tok", (async () => { requests++; return { ok: true, status: 204, json: async () => { throw new Error("no body"); } }; }) as never);
    await expect(api.batchModifyMessages([], ["TRASH"], ["INBOX"])).rejects.toThrow();
    await expect(api.batchModifyMessages(Array.from({ length: 1001 }, (_, i) => "m" + i), ["TRASH"], ["INBOX"])).rejects.toThrow();
    expect(requests).toBe(0);
    // ...and success is an empty 204 that is never parsed.
    await expect(api.batchModifyMessages(["a"], ["TRASH"], ["INBOX"])).resolves.toBeUndefined();
    expect(requests).toBe(1);
  });

  it("posts to messages.batchModify, and this app's API has no permanent-delete call at all", async () => {
    const seen: { url: string; body: string }[] = [];
    const api = createGoogleApi("tok", (async (url: string, init?: { body?: string }) => { seen.push({ url, body: init?.body ?? "" }); return { ok: true, status: 204, json: async () => ({}) }; }) as never);
    await api.batchModifyMessages(["a", "b"], ["TRASH"], ["INBOX"]);
    expect(seen[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify");
    expect(JSON.parse(seen[0]!.body)).toEqual({ ids: ["a", "b"], addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] });
    expect(Object.keys(api).filter((k) => /batchDelete|permanent|expunge|deleteMessage/i.test(k))).toEqual([]);
  });
});

describe("frozen ids", () => {
  it("mail that arrives while it runs is not silently swept in", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "f", { messages: 2 });
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure });
    const late = box.receive("f1"); // arrives after the plan, before the move
    const res = await trashSelection(plan, { ensure });
    expect(summarize(res).trashed).toBe(2);
    expect(box.labelsOf(late)).toContain("INBOX");
    expect(box.labelsOf(late)).not.toContain("TRASH");
  });

  it("content that moved since the row was read is flagged for reconfirmation", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "c");
    const rows = await rowsOf(box);
    box.receive("c2"); // a new reply the screen has not seen
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }) });
    expect(plan.changed).toEqual(["c2"]);
  });

  it("a trusted single-message row costs no read at all", async () => {
    const box = new FakeMailbox();
    fill(box, 4, "s");
    const rows = await rowsOf(box);
    const before = box.counters.metadata;
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }), trusted: () => true });
    expect(box.counters.metadata - before).toBe(0);
    expect(plan.conversations).toBe(4);
    expect(box.counters.bodies).toBe(0);
  });

  it("an untrusted row is read (metadata only, never a body) and its labels snapshotted", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "u");
    const rows = await rowsOf(box);
    const before = { ...box.counters };
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }) });
    expect(box.counters.metadata - before.metadata).toBe(2);
    expect(box.counters.bodies - before.bodies).toBe(0);
    expect(plan.accounts[0]!.threads[0]!.before[plan.accounts[0]!.threads[0]!.messageIds[0]!]).toEqual({ inbox: true, trash: false });
  });

  it("a thread deleted meanwhile, or already all in Trash, is 'gone' and gets no write", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "g");
    const rows = await rowsOf(box);
    box.remove("g1");
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }) });
    expect(plan.gone).toEqual(["g1"]);
    expect(plan.conversations).toBe(1);
  });
});

describe("no account, no write", () => {
  it("a selection whose account is not connected is blocked, not sent through another account", async () => {
    const a = new FakeMailbox("a@x.com");
    const b = new FakeMailbox("b@x.com");
    fill(a, 1, "a");
    fill(b, 1, "b");
    const rows = [...(await rowsOf(a)), ...(await rowsOf(b))];
    // Only account a is connected.
    const ensure = ensureFor({ "a@x.com": a });
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    expect(plan.blocked.map((x) => x.account)).toEqual(["b@x.com"]);
    const res = await trashSelection(plan, { ensure });
    expect(a.batchCalls).toHaveLength(1);
    expect(b.batchCalls).toHaveLength(0);
    expect(summarize(res).blocked).toBe(1);
  });

  it("a row with no account at all is blocked, never given the first account", async () => {
    const a = new FakeMailbox("a@x.com");
    fill(a, 1, "a");
    const rows = (await rowsOf(a)).map((r) => ({ ...r, account: undefined }));
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ "a@x.com": a }), trusted: () => true });
    expect(plan.blocked).toHaveLength(1);
    expect(plan.conversations).toBe(0);
    expect(a.batchCalls).toHaveLength(0);
  });

  it("a session that dies between the plan and the write stops that account before any request", async () => {
    const box = new FakeMailbox();
    fill(box, 2);
    const rows = await rowsOf(box);
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }), trusted: () => true });
    const dead: EnsureApi = async () => ({ ok: false, message: "Google revoked this sign-in. Reconnect " + box.email + ".", code: "GOOGLE_SIGNIN_REVOKED" });
    const res = await trashSelection(plan, { ensure: dead });
    expect(box.batchCalls).toHaveLength(0);
    expect(res.accounts[0]).toMatchObject({ status: "blocked", code: "GOOGLE_SIGNIN_REVOKED" });
    expect(summarize(res)).toMatchObject({ trashed: 0, failed: 2 });
  });
});

describe("failures, one account at a time", () => {
  it("an auth failure stops that account's remaining chunks and lets the other account finish", async () => {
    const a = new FakeMailbox("a@x.com");
    const b = new FakeMailbox("b@x.com");
    fill(a, 1500, "a"); // two chunks
    fill(b, 5, "b");
    const rows = [...(await rowsOf(a)), ...(await rowsOf(b))];
    a.batchBehavior = () => 403;
    const ensure = ensureFor({ "a@x.com": a, "b@x.com": b });
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    const res = await trashSelection(plan, { ensure });
    expect(a.batchCalls).toHaveLength(1); // the second chunk was never attempted
    expect(res.accounts.find((x) => x.account === "a@x.com")).toMatchObject({ status: "stopped", code: "GOOGLE_SIGNIN_REVOKED" });
    expect(res.accounts.find((x) => x.account === "b@x.com")!.status).toBe("ok");
    const s = summarize(res);
    expect(s.trashed).toBe(5);
    expect(s.failed).toBe(1500);
    expect(receiptLine(res)).toContain("5 conversations moved to Trash. Gmail keeps them for 30 days.");
    expect(receiptLine(res)).toContain("1500 not moved");
  }, 60000);

  it("at most two accounts are written at once", async () => {
    const boxes = ["a", "b", "c", "d"].map((n) => new FakeMailbox(n + "@x.com"));
    boxes.forEach((b) => fill(b, 2, b.email[0]!));
    const rows = (await Promise.all(boxes.map((b) => rowsOf(b)))).flat();
    let live = 0; let peak = 0;
    const slow = (b: FakeMailbox) => {
      const api = b.api();
      const orig = api.batchModifyMessages;
      api.batchModifyMessages = async (...args) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); try { return await orig(...args); } finally { live--; } };
      return api;
    };
    const ensure = ensureFor(Object.fromEntries(boxes.map((b) => [b.email, b])), slow);
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    const res = await trashSelection(plan, { ensure });
    expect(summarize(res).trashed).toBe(8);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it("a lost answer is read back: a request that landed is confirmed, and never re-sent", async () => {
    const box = new FakeMailbox();
    fill(box, 3, "l");
    const rows = await rowsOf(box);
    box.batchBehavior = () => "network-applied";
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    const res = await trashSelection(plan, { ensure });
    expect(box.batchCalls).toHaveLength(1);
    expect(summarize(res).trashed).toBe(3);
    expect(res.accounts[0]!.status).toBe("ok");
  });

  it("a lost request that never landed is read back as not moved, and not claimed", async () => {
    const box = new FakeMailbox();
    fill(box, 3, "n");
    const rows = await rowsOf(box);
    box.batchBehavior = () => "network";
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure, trusted: () => true });
    const res = await trashSelection(plan, { ensure });
    expect(box.batchCalls).toHaveLength(1);
    expect(summarize(res)).toMatchObject({ trashed: 0, failed: 3 });
    for (const r of rows) expect(box.labelsOf(r.lastMsgId)).toContain("INBOX");
  });

  it("if even the read-back fails the outcome is unknown, said as unknown", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "k");
    const rows = await rowsOf(box);
    box.batchBehavior = () => "network";
    const ensure = ensureFor({ [box.email]: box }, (b) => b.api({ getThreadMeta: async () => { throw new Error("offline"); } }));
    const plan = await buildTrashPlan(rows, { ensure: ensureFor({ [box.email]: box }), trusted: () => true });
    const res = await trashSelection(plan, { ensure });
    expect(summarize(res).unknown).toBe(2);
    expect(receiptLine(res)).toContain("2 unconfirmed \u00b7 Check your Trash");
  });

  it("a conversation that straddles two chunks, with the second refused, is partial: said precisely", async () => {
    const box = new FakeMailbox();
    box.add("big", { messages: 2 }); // the oldest, so its two messages fall at the chunk boundary
    fill(box, 999, "s");
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure, trusted: (r) => r.count === 1 });
    expect(plan.messages).toBe(1001);
    box.batchBehavior = (call) => (call === 0 ? "ok" : 400);
    const res = await trashSelection(plan, { ensure });
    expect(res.requests).toBe(2);
    expect(summarize(res)).toMatchObject({ trashed: 999, partial: 1 });
    expect(receiptLine(res)).toContain("1 conversation only partly moved");
    // Undo puts back the part that moved, and says the conversation is not whole.
    box.batchBehavior = () => "ok";
    const undo = await undoTrashSelection(res, { ensure });
    expect(undo.restored).not.toContain("big");
    expect(undo.failed).toContain("big");
  }, 60000);
});

describe("Undo", () => {
  it("removes TRASH and restores INBOX only where it was, and preserves other labels", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "z");
    const rows = await rowsOf(box);
    // z2 was read and archived elsewhere between listing and deleting: not in the inbox.
    box.archive("z2");
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure });
    const res = await trashSelection(plan, { ensure });
    expect(summarize(res).trashed).toBe(2);
    const z1 = box.messageIdsOf("z1")[0]!;
    const z2 = box.messageIdsOf("z2")[0]!;
    const undo = await undoTrashSelection(res, { ensure });
    expect(undo.restored.sort()).toEqual(["z1", "z2"]);
    expect(box.labelsOf(z1)).toContain("INBOX");
    expect(box.labelsOf(z1)).not.toContain("TRASH");
    expect(box.labelsOf(z1)).toContain("UNREAD"); // untouched
    expect(box.labelsOf(z2)).not.toContain("INBOX"); // it was not in the inbox before
    expect(box.labelsOf(z2)).not.toContain("TRASH");
  });

  it("never untrashes mail that was already in Trash before, nor mail that arrived later", async () => {
    const box = new FakeMailbox();
    box.add("q1", { messages: 3 });
    const [first, second, third] = box.messageIdsOf("q1");
    // The first message was already trashed by hand a week ago.
    await box.api().batchModifyMessages([first!], ["TRASH"], ["INBOX"]);
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const plan = await buildTrashPlan(rows, { ensure });
    expect(plan.accounts[0]!.threads[0]!.alreadyTrashed).toEqual([first]);
    expect(plan.messages).toBe(2);
    const res = await trashSelection(plan, { ensure });
    const later = box.receive("q1");
    await undoTrashSelection(res, { ensure });
    expect(box.labelsOf(first!)).toContain("TRASH"); // still trashed: not this action's
    expect(box.labelsOf(second!)).not.toContain("TRASH");
    expect(box.labelsOf(third!)).not.toContain("TRASH");
    expect(box.labelsOf(later)).toEqual(["INBOX", "UNREAD"]); // never touched
  });

  it("only what was confirmed trashed is undone: a failed conversation gets no write", async () => {
    const a = new FakeMailbox("a@x.com");
    const b = new FakeMailbox("b@x.com");
    fill(a, 2, "a");
    fill(b, 2, "b");
    const rows = [...(await rowsOf(a)), ...(await rowsOf(b))];
    b.batchBehavior = () => 400;
    const ensure = ensureFor({ "a@x.com": a, "b@x.com": b });
    const res = await trashSelection(await buildTrashPlan(rows, { ensure, trusted: () => true }), { ensure });
    const bBefore = b.batchCalls.length;
    const undo = await undoTrashSelection(res, { ensure });
    expect(undo.restored.sort()).toEqual(["a1", "a2"]);
    expect(b.batchCalls.length).toBe(bBefore); // nothing sent for the account that never moved
  });

  it("an undo that cannot complete says so and leaves the mail in Trash", async () => {
    const box = new FakeMailbox();
    fill(box, 2, "y");
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const res = await trashSelection(await buildTrashPlan(rows, { ensure, trusted: () => true }), { ensure });
    box.batchBehavior = () => 500;
    const undo = await undoTrashSelection(res, { ensure });
    expect(undo.restored).toEqual([]);
    expect(undo.failed.sort()).toEqual(["y1", "y2"]);
    expect(undo.message).toContain("Trash");
  });
});

describe("what the person is asked and told", () => {
  it("asks ONCE for the whole batch, and only when something may need him", () => {
    expect(confirmCopy(40, 0)).toBeNull();
    expect(confirmCopy(40, 3)).toEqual({ title: "Move 40 conversations to Trash? 3 may need you.", confirm: "Move to Trash", cancel: "Cancel" });
    expect(confirmCopy(1, 1)?.title).toBe("Move 1 conversation to Trash? 1 may need you.");
  });
  it("the receipt names the count and the 30 days, and never claims more than was confirmed", async () => {
    const box = new FakeMailbox();
    fill(box, 2);
    const rows = await rowsOf(box);
    const ensure = ensureFor({ [box.email]: box });
    const res = await trashSelection(await buildTrashPlan(rows, { ensure, trusted: () => true }), { ensure });
    expect(receiptLine(res)).toBe("2 conversations moved to Trash. Gmail keeps them for 30 days.");
    expect(receiptLine({ ...res, outcomes: [], blocked: [] })).toBe("Nothing to move");
  });
});
