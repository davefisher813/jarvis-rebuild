import { describe, it, expect } from "vitest";
import {
  categoryFor, declineRule, forgetRule, groupedLine, loadRules, loadTaps, recordTap, rememberRule, saveRules, saveTaps, suggestionDue,
  TAPS_KEY, RULES_KEY, type CategoryTap, type RuleDecisions,
} from "./categoryTaps";

const tap = (n: number, day: number, over: Partial<CategoryTap> = {}): CategoryTap => ({
  id: `t${n}`, at: new Date(Date.UTC(2026, 9, day, 12)).toISOString(), accountId: "acct-a", senderExact: "Billing@ConEdison.test", categoryId: "money", ...over,
});
const NOW = "2026-10-20T12:00:00Z";
const none: RuleDecisions = { dismissed: {} };

describe("category preference suggestions: three taps, one question, never a grant", () => {
  it("two matching taps ask nothing; the third asks, with the three taps as evidence", () => {
    let taps: CategoryTap[] = [];
    taps = recordTap(taps, tap(1, 2));
    taps = recordTap(taps, tap(2, 5));
    expect(suggestionDue(taps, tap(2, 5), [], none, NOW)).toBeNull();
    taps = recordTap(taps, tap(3, 9));
    expect(suggestionDue(taps, tap(3, 9), [], none, NOW)).toEqual({ rule: { sender_exact: "billing@conedison.test", account_id: "acct-a", category_id: "money" }, evidence_tap_ids: ["t1", "t2", "t3"] });
  });
  it("a tap older than 30 days does not count, nor a different category, sender or account", () => {
    const old = recordTap(recordTap(recordTap([], tap(1, 2, { at: "2026-08-01T12:00:00Z" })), tap(2, 5)), tap(3, 9));
    expect(suggestionDue(old, tap(3, 9), [], none, NOW)).toBeNull();
    const mixed = recordTap(recordTap(recordTap([], tap(1, 2, { categoryId: "work" })), tap(2, 5)), tap(3, 9));
    expect(suggestionDue(mixed, tap(3, 9), [], none, NOW)).toBeNull();
    const other = recordTap(recordTap(recordTap([], tap(1, 2, { accountId: "acct-b" })), tap(2, 5)), tap(3, 9));
    expect(suggestionDue(other, tap(3, 9), [], none, NOW)).toBeNull();
  });
  it("Remember creates the exact rule, which only names a category; Not now creates nothing and asks again after three new taps", () => {
    const taps = recordTap(recordTap(recordTap([], tap(1, 2)), tap(2, 5)), tap(3, 9));
    const due = suggestionDue(taps, tap(3, 9), [], none, NOW)!;
    const rules = rememberRule([], due.rule, "sug-1", NOW);
    expect(rules).toEqual([{ ...due.rule, acceptedAt: NOW, suggestionId: "sug-1" }]);
    expect(categoryFor(rules, { accountId: "acct-a", fromAddress: "BILLING@conedison.test" })).toBe("money");
    expect(categoryFor(rules, { accountId: "acct-b", fromAddress: "billing@conedison.test" })).toBeNull();
    expect(suggestionDue(taps, tap(3, 9), rules, none, NOW)).toBeNull();
    const declined = declineRule(none, taps, due.rule, NOW);
    expect(suggestionDue(taps, tap(3, 9), [], declined, NOW)).toBeNull();
    let more = recordTap(recordTap(taps, tap(4, 10)), tap(5, 11));
    expect(suggestionDue(more, tap(5, 11), [], declined, NOW)).toBeNull();
    more = recordTap(more, tap(6, 12));
    expect(suggestionDue(more, tap(6, 12), [], declined, NOW)?.evidence_tap_ids).toEqual(["t4", "t5", "t6"]);
    expect(forgetRule(rules, due.rule)).toEqual([]);
  });
  it("the receipt says grouped, and keeps the rows", () => {
    expect(groupedLine(41)).toBe("Grouped 41 Updates by Category");
    expect(groupedLine(1)).toBe("Grouped 1 Update by Category");
  });
  it("storage is versioned and a corrupt value is an empty store", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveTaps(storage, [tap(1, 2)]);
    saveRules(storage, { rules: rememberRule([], { sender_exact: "a@b.test", account_id: "acct-a", category_id: "work" }, null, NOW), decisions: none });
    expect(loadTaps(storage)).toHaveLength(1);
    expect(loadRules(storage).rules[0]?.category_id).toBe("work");
    expect(TAPS_KEY).toMatch(/\.v\d+$/);
    expect(RULES_KEY).toMatch(/\.v\d+$/);
    mem.set(TAPS_KEY, "{broken"); mem.set(RULES_KEY, "[]");
    expect(loadTaps(storage)).toEqual([]);
    expect(loadRules(storage)).toEqual({ rules: [], decisions: { dismissed: {} } });
  });
});
