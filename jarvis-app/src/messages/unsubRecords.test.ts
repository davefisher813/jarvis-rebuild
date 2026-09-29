// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadUnsubs, recordUnsub, askedSenders, askedFor, stillSending, unsubReceipt, canBlock, BLOCK_AFTER } from "./unsubRecords";

// UP-MIND-17. The asked list used to be addresses and nothing else, so the
// app could say "asked" and never "asked three weeks ago and they are still
// sending", which is the fact that earns the next move.

beforeEach(() => localStorage.clear());

describe("what the app remembers about an ask", () => {
  it("keeps when, how, and from which account", () => {
    recordUnsub({ sender: "News@Shop.com", askedISO: "2026-08-01", via: "header", account: "me@x.com" });
    expect(loadUnsubs()).toEqual([{ sender: "news@shop.com", askedISO: "2026-08-01", via: "header", account: "me@x.com" }]);
  });

  it("keeps one record per sender, the newest", () => {
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-08-01", via: "header" });
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-09-01", via: "link" });
    expect(loadUnsubs()).toHaveLength(1);
    expect(loadUnsubs()[0]!.askedISO).toBe("2026-09-01");
  });

  // The v1 list held addresses only. They keep their place, so a sender the
  // user already answered about is never asked again, and they carry no date
  // to count from, which the receipt says rather than inventing one.
  it("carries the old list forward without inventing a date", () => {
    localStorage.setItem("jarvis.mail.tossasked.v1", JSON.stringify(["OLD@shop.com"]));
    expect(askedSenders(loadUnsubs())).toEqual(["old@shop.com"]);
    expect(stillSending(loadUnsubs(), [{ fromEmail: "old@shop.com", dateMs: Date.now() }])).toEqual([]);
  });

  it("drops anything malformed rather than repairing it", () => {
    localStorage.setItem("jarvis.mail.unsub.v2", JSON.stringify([{ sender: "a@b.c" }, { askedISO: "2026-08-01" }, "no"]));
    expect(loadUnsubs()).toEqual([]);
  });
});

describe("did it work", () => {
  const asked = { sender: "news@shop.com", askedISO: "2026-08-01", via: "header" as const };
  const after = (n: number) => Array.from({ length: n }, () => ({ fromEmail: "news@shop.com", dateMs: Date.parse("2026-08-20T09:00:00Z") }));

  it("counts only what arrived after the ask", () => {
    const rows = [...after(2), { fromEmail: "news@shop.com", dateMs: Date.parse("2026-07-01T09:00:00Z") }];
    expect(stillSending([asked], rows)[0]!.since).toBe(2);
  });

  it("says nothing when they stopped", () => {
    expect(stillSending([asked], [{ fromEmail: "news@shop.com", dateMs: Date.parse("2026-07-20T09:00:00Z") }])).toEqual([]);
  });

  // One more mail after an unsubscribe is the queue draining, which is what
  // "takes a few days" means. Three is a sender that did not stop.
  it("only offers the Block once they have really not stopped", () => {
    expect(canBlock({ record: asked, since: BLOCK_AFTER - 1 })).toBe(false);
    expect(canBlock({ record: asked, since: BLOCK_AFTER })).toBe(true);
  });

  // Whether it worked is the row's own second fact, drawn with the facts
  // line's separator (§AM R6), so the receipt says when and nothing else,
  // and never carries a typed dot.
  it("states when, and nothing else", () => {
    // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
    expect(unsubReceipt(asked, "2026-08-22")).toBe("Asked 3 Weeks Ago");
    expect(unsubReceipt({ ...asked, askedISO: "2026-08-21" }, "2026-08-22")).toBe("Asked Yesterday");
    expect(unsubReceipt({ ...asked, askedISO: "2026-08-22" }, "2026-08-22")).toBe("Asked Today");
    expect(unsubReceipt({ ...asked, askedISO: "" }, "2026-08-22")).toBe("Asked");
    for (const r of [asked, { ...asked, askedISO: "" }]) {
      expect(unsubReceipt(r, "2026-08-22")).not.toMatch(/\u00b7|still sending/i);
    }
  });
});

// 2026-09-29: a record belongs to an ACCOUNT and a sender. A sender only honours
// an unsubscribe from the subscribed address, so asking from one mailbox says
// nothing about another, and keying by sender alone let the second account's
// ask replace the first's.
describe("one record per account and sender", () => {
  it("keeps the same sender asked from two accounts as two records", () => {
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-08-01", via: "header", account: "a@x.com" });
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-09-01", via: "header", account: "b@x.com" });
    expect(loadUnsubs().map((r) => r.account).sort()).toEqual(["a@x.com", "b@x.com"]);
  });
  it("asking again from the same account replaces that account's record only", () => {
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-08-01", via: "header", account: "a@x.com" });
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-08-05", via: "header", account: "b@x.com" });
    recordUnsub({ sender: "N@shop.com", askedISO: "2026-09-01", via: "link", account: "A@x.com" });
    const list = loadUnsubs();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.account === "b@x.com")!.askedISO).toBe("2026-08-05");
    expect(list.find((r) => r.account?.toLowerCase() === "a@x.com")!.askedISO).toBe("2026-09-01");
  });
  it("an old record with no account is kept, answers for any account, and yields to an account's own ask", () => {
    localStorage.setItem("jarvis.mail.unsub.v2", JSON.stringify([{ sender: "n@shop.com", askedISO: "2026-08-01", via: "header" }]));
    expect(askedFor(loadUnsubs(), "n@shop.com", "a@x.com")).toBe(true);
    expect(askedFor(loadUnsubs(), "n@shop.com")).toBe(true);
    expect(askedFor(loadUnsubs(), "other@shop.com", "a@x.com")).toBe(false);
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-09-01", via: "header", account: "a@x.com" });
    expect(loadUnsubs()).toHaveLength(2); // the old fact is not forgotten
    const rows = [{ fromEmail: "n@shop.com", dateMs: Date.parse("2026-09-10T09:00:00Z"), account: "a@x.com" }];
    // Counted once, from the account's own record, not twice.
    expect(stillSending(loadUnsubs(), rows)).toHaveLength(1);
    expect(stillSending(loadUnsubs(), rows)[0]!.record.account).toBe("a@x.com");
  });
  it("counts still-sending only in the mailbox that was asked", () => {
    const rec = { sender: "n@shop.com", askedISO: "2026-08-01", via: "header" as const, account: "a@x.com" };
    const at = Date.parse("2026-08-20T09:00:00Z");
    expect(stillSending([rec], [{ fromEmail: "n@shop.com", dateMs: at, account: "b@x.com" }])).toEqual([]);
    expect(stillSending([rec], [{ fromEmail: "n@shop.com", dateMs: at, account: "a@x.com" }])).toHaveLength(1);
  });
  it("a web page opened is recorded as opened, and the receipt says so", () => {
    recordUnsub({ sender: "n@shop.com", askedISO: "2026-09-01", via: "link", state: "opened", account: "a@x.com" });
    const r = loadUnsubs()[0]!;
    expect(r.state).toBe("opened");
    expect(unsubReceipt(r, "2026-09-03")).toBe("Opened Page 2 Days Ago");
    expect(unsubReceipt({ ...r, state: "asked" }, "2026-09-03")).toBe("Asked 2 Days Ago");
    expect(unsubReceipt({ ...r, state: undefined }, "2026-09-03")).toBe("Asked 2 Days Ago");
  });
});
