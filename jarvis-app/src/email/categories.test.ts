// CATEGORY CHIPS ARE LOCAL, EXPLICIT AND NEVER HIDE (IMPLEMENTATION-SPEC.md
// 08 E04, 00.1). A tap tags one message; three taps on one sender earn one
// question; Remember makes a rule that only tags; no rule means no category.
import { describe, it, expect } from "vitest";
import { categoryOf, countsByCategory, fileUnder, loadRules, loadTags, notNow, remember } from "./categories";
import type { InboxRow } from "./emailClient";

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const row = (id: string, from = "billing@conedison.test", account_id = "acct-1"): InboxRow => ({
  id, account_id, account: "dave@example.test", provider_id: id, thread_id: id, internal_date: "2026-10-03T10:00:00Z", from_address: from, from_name: "",
  subject: "s", snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true,
});
const T = (n: number) => new Date(Date.UTC(2026, 9, 3, 10, n)).toISOString();

describe("what a row shows under", () => {
  it("is the person's tag first, a remembered rule second, nothing third", () => {
    const s = new MemStore();
    expect(categoryOf(row("m1"), {}, loadRules(s))).toBeNull();
    const rules = remember({ sender_exact: "billing@conedison.test", account_id: "acct-1", category_id: "bills" }, null, T(0), s);
    expect(categoryOf(row("m1"), {}, rules)).toBe("bills");
    expect(categoryOf(row("m1"), { m1: "personal" }, rules)).toBe("personal");
    // The rule is exact: another account, another sender, no category.
    expect(categoryOf(row("m2", "billing@conedison.test", "acct-2"), {}, rules)).toBeNull();
    expect(categoryOf(row("m3", "other@conedison.test"), {}, rules)).toBeNull();
  });
  it("counts the loaded rows per category and leaves the untagged out", () => {
    const s = new MemStore();
    const rules = remember({ sender_exact: "billing@conedison.test", account_id: "acct-1", category_id: "bills" }, null, T(0), s);
    expect(countsByCategory([row("m1"), row("m2"), row("m3", "a@b.test")], { m3: "work" }, rules)).toEqual({ bills: 2, work: 1 });
  });
});

describe("File Under", () => {
  it("tags the message on this phone and asks the one question on the third matching tap", () => {
    const s = new MemStore();
    const u = "user-1";
    const first = fileUnder(u, row("m1"), "bills", T(0), s, "t1");
    expect(first.tags).toEqual({ m1: "bills" });
    expect(first.suggestion).toBeNull();
    expect(loadTags(u, s)).toEqual({ m1: "bills" });
    expect(fileUnder(u, row("m2"), "bills", T(1), s, "t2").suggestion).toBeNull();
    const third = fileUnder(u, row("m3"), "bills", T(2), s, "t3");
    expect(third.suggestion).toEqual({ rule: { sender_exact: "billing@conedison.test", account_id: "acct-1", category_id: "bills" }, evidence_tap_ids: ["t1", "t2", "t3"] });
  });
  it("Not Now holds the question until three new taps; Remember ends it", () => {
    const s = new MemStore();
    const u = "user-1";
    fileUnder(u, row("m1"), "bills", T(0), s, "t1"); fileUnder(u, row("m2"), "bills", T(1), s, "t2");
    const third = fileUnder(u, row("m3"), "bills", T(2), s, "t3");
    notNow(third.suggestion!.rule, T(2), s);
    expect(fileUnder(u, row("m4"), "bills", T(3), s, "t4").suggestion).toBeNull();
    expect(fileUnder(u, row("m5"), "bills", T(4), s, "t5").suggestion).toBeNull();
    const again = fileUnder(u, row("m6"), "bills", T(5), s, "t6");
    expect(again.suggestion?.evidence_tap_ids).toEqual(["t4", "t5", "t6"]);
    remember(again.suggestion!.rule, "sugg-1", T(5), s);
    expect(fileUnder(u, row("m7"), "bills", T(6), s, "t7").suggestion).toBeNull();
    expect(loadRules(s).rules[0]).toMatchObject({ sender_exact: "billing@conedison.test", suggestionId: "sugg-1" });
  });
  it("tags are per user", () => {
    const s = new MemStore();
    fileUnder("u1", row("m1"), "bills", T(0), s);
    expect(loadTags("u2", s)).toEqual({});
  });
});
