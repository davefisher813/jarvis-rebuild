// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadUnsubs, recordUnsub, askedSenders, stillSending, unsubReceipt, canBlock, BLOCK_AFTER } from "./unsubRecords";

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

  it("states when, and whether it worked, and nothing else", () => {
    expect(unsubReceipt(asked, 0, "2026-08-22")).toBe("Asked 3 weeks ago");
    expect(unsubReceipt(asked, 4, "2026-08-22")).toBe("Asked 3 weeks ago · Still sending");
    expect(unsubReceipt({ ...asked, askedISO: "2026-08-22" }, 0, "2026-08-22")).toBe("Asked today");
    expect(unsubReceipt({ ...asked, askedISO: "" }, 0, "2026-08-22")).toBe("Asked");
  });
});
