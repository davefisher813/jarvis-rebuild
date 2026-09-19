import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TrackerService } from "./TrackerService";
import { SEED_TXS } from "./trackerSeed";
import {
  byCategory, categoryColor, dollarsToCents, fmtCents, fmtDay, inMonth, incomeCents,
  knownCategories, monthLabel, monthlyCents, monthlySubTotal, monthOf, shiftMonth,
  spentCents, topMerchants, type TrackerSub, type TrackerTx, type TrackerTxData,
} from "./tracker";

const tx = (over: Partial<TrackerTxData>): TrackerTx => ({
  id: "t" + Math.random().toString(36).slice(2),
  data: {
    date: "2026-09-08", month: "2026-09", merchant: "Somewhere", name: "Somewhere",
    amountCents: 1000, category: "Other", account: "EVERYDAY CHECKING ...0860", ...over,
  },
});

describe("tracker money and dates", () => {
  it("a ledger amount always carries its cents, unlike a self-entered balance", () => {
    // types.ts's formatMoney drops ".00"; a column of amounts must not, or
    // the rows stop lining up against each other.
    expect(fmtCents(10500)).toBe("$105.00");
    expect(fmtCents(12669)).toBe("$126.69");
    expect(fmtCents(2651241)).toBe("$26,512.41");
    expect(fmtCents(-4500)).toBe("-$45.00");
    expect(fmtCents(0)).toBe("$0.00");
  });

  it("a typed amount reads as cents, and junk reads as nothing rather than NaN", () => {
    expect(dollarsToCents("49.99")).toBe(4999);
    expect(dollarsToCents("$1,295.27")).toBe(129527);
    expect(dollarsToCents("")).toBe(0);
    expect(dollarsToCents("abc")).toBe(0);
  });

  it("the month comes from the date, and stepping months carries the year", () => {
    expect(monthOf("2026-09-14")).toBe("2026-09");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", -3)).toBe("2026-06");
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(fmtDay("2026-09-14")).toBe("Sep 14");
  });
});

describe("what a month did", () => {
  const txs = [
    tx({ merchant: "Blue Note", amountCents: 7991, category: "Restaurants" }),
    tx({ merchant: "Amazon", amountCents: 4996, category: "Digital Purchase" }),
    tx({ merchant: "Amazon", amountCents: 4243, category: "Digital Purchase" }),
    tx({ merchant: "Paycheck", amountCents: -250000, category: "Income" }),
    tx({ merchant: "Old One", amountCents: 500, category: "Golf", date: "2026-08-02", month: "2026-08" }),
  ];

  it("spent counts only money out, and income only money in", () => {
    const sep = inMonth(txs, "2026-09");
    expect(sep).toHaveLength(4);
    expect(spentCents(sep)).toBe(7991 + 4996 + 4243);
    expect(incomeCents(sep)).toBe(250000);
  });

  it("a category total is spending alone: income is not a negative expense", () => {
    const cats = byCategory(inMonth(txs, "2026-09"));
    expect(cats).toEqual([["Digital Purchase", 9239], ["Restaurants", 7991]]);
    expect(cats.some(([c]) => c === "Income")).toBe(false);
  });

  it("merchants add up across their own rows, biggest first", () => {
    expect(topMerchants(inMonth(txs, "2026-09"))).toEqual([
      ["Amazon", 9239],
      ["Blue Note", 7991],
    ]);
  });

  it("a month with nothing in it totals zero rather than breaking", () => {
    expect(spentCents([])).toBe(0);
    expect(byCategory([])).toEqual([]);
    expect(topMerchants([])).toEqual([]);
  });
});

describe("subscriptions cost the same month either way they bill", () => {
  const sub = (over: Partial<TrackerSub["data"]>): TrackerSub => ({
    id: "s" + Math.random().toString(36).slice(2),
    data: { merchantName: "Thing", amountCents: 1000, frequency: "Monthly", status: "active", ...over },
  });

  it("a yearly plan is twelfths and a weekly one is not four weeks", () => {
    expect(monthlyCents({ merchantName: "x", amountCents: 12000, frequency: "Yearly", status: "active" })).toBe(1000);
    // 52 weeks over 12 months, not 4 weeks a month: the difference is a
    // month's worth of the charge every year.
    expect(monthlyCents({ merchantName: "x", amountCents: 1000, frequency: "Weekly", status: "active" })).toBe(4333);
  });

  it("a cancelled subscription costs nothing and still shows in the list", () => {
    const subs = [sub({ amountCents: 1499 }), sub({ amountCents: 3189, status: "cancelled" })];
    expect(monthlySubTotal(subs)).toBe(1499);
  });
});

describe("category colours", () => {
  it("a named category keeps its colour, and an unknown one keeps its own", () => {
    expect(categoryColor("Restaurants")).toBe("#ff4d5e");
    expect(categoryColor("Overdraft")).toBe("#ff3b30");
    // Stable between renders: the same name is the same colour every time.
    expect(categoryColor("Dog Grooming", 2)).toBe(categoryColor("Dog Grooming", 2));
  });

  it("Other is always offered, so a new transaction has somewhere to go", () => {
    expect(knownCategories([])).toContain("Other");
    expect(knownCategories([tx({ category: "Golf" })])).toEqual(["Golf", "Other"]);
  });
});

// THE ACCEPTANCE NUMBERS (PASSOFF: "dashboard totals match the seed, Spent
// $1,145.68 across 31 transactions"). These are the figures on the handoff's
// own screenshot, so they are the check that the port did not quietly lose
// or double a row on the way in.
describe("the September seed", () => {
  const txs: TrackerTx[] = SEED_TXS.map((d, i) => ({ id: "s" + i, data: d }));

  it("is 31 transactions totalling $1,145.68 across 11 categories", () => {
    expect(txs).toHaveLength(31);
    expect(spentCents(txs)).toBe(114568);
    expect(fmtCents(spentCents(txs))).toBe("$1,145.68");
    expect(byCategory(txs)).toHaveLength(11);
  });

  it("puts the same five categories on top as the approved screenshot", () => {
    expect(byCategory(txs).slice(0, 5)).toEqual([
      ["Restaurants", 28533],
      ["Digital Purchase", 25394],
      ["Golf", 14899],
      ["Food and Beverage Store", 12669],
      ["Overdraft", 10500],
    ]);
  });

  it("names Amazon its biggest merchant, and shows eight of them", () => {
    const top = topMerchants(txs);
    expect(top).toHaveLength(8);
    expect(top[0]).toEqual(["Amazon", 15568]);
  });

  it("files every row under the month its date falls in", () => {
    expect(inMonth(txs, "2026-09")).toHaveLength(31);
    expect(txs.every((t) => t.data.month === monthOf(t.data.date))).toBe(true);
  });
});

describe("TrackerService", () => {
  const svc = () => new TrackerService(new Store(new InMemoryAdapter()), "u");

  it("imports September once, and the second tap writes nothing", async () => {
    const s = svc();
    expect(await s.seedIfEmpty()).toBe(true);
    const first = await s.load();
    expect(first.txs).toHaveLength(31);
    expect(first.accounts).toHaveLength(4);
    expect(first.subs).toHaveLength(3);

    // The guard is the whole point: a double tap must not double the ledger.
    expect(await s.seedIfEmpty()).toBe(false);
    const second = await s.load();
    expect(second.txs).toHaveLength(31);
    expect(second.accounts).toHaveLength(4);
  });

  it("refiles a transaction when its date moves to another month", async () => {
    const s = svc();
    const id = await s.saveTx(null, {
      date: "2026-09-20", month: "2026-09", merchant: "Uncorked", name: "",
      amountCents: 2319, category: "Restaurants", account: "EVERYDAY CHECKING ...0860",
    });
    expect(id).toBeTruthy();
    const made = (await s.load()).txs[0]!;
    // The name falls back to the merchant rather than saving empty.
    expect(made.data.name).toBe("Uncorked");

    await s.saveTx(made.id, { ...made.data, date: "2026-10-02" });
    const moved = (await s.load()).txs[0]!;
    expect(moved.data.month).toBe("2026-10");
    expect(inMonth((await s.load()).txs, "2026-09")).toHaveLength(0);
  });

  it("refuses a transaction with no merchant, no amount or no date", async () => {
    const s = svc();
    const base: TrackerTxData = {
      date: "2026-09-20", month: "2026-09", merchant: "Uncorked", name: "Uncorked",
      amountCents: 2319, category: "Restaurants", account: "",
    };
    expect(await s.saveTx(null, { ...base, merchant: "  " })).toBeNull();
    expect(await s.saveTx(null, { ...base, amountCents: 0 })).toBeNull();
    expect(await s.saveTx(null, { ...base, date: "" })).toBeNull();
    expect((await s.load()).txs).toHaveLength(0);
  });

  it("keeps one budget per month: saving again edits, never adds", async () => {
    const s = svc();
    await s.saveBudget({ month: "2026-09", expectedIncomeCents: 500000, savingsTargetCents: 100000, allocations: {} });
    await s.saveBudget({ month: "2026-09", expectedIncomeCents: 600000, savingsTargetCents: 120000, allocations: { Golf: 20000 } });
    await s.saveBudget({ month: "2026-10", expectedIncomeCents: 500000, savingsTargetCents: 0, allocations: {} });
    const { budgets } = await s.load();
    expect(budgets).toHaveLength(2);
    const sep = budgets.find((b) => b.data.month === "2026-09")!;
    expect(sep.data.expectedIncomeCents).toBe(600000);
    expect(sep.data.allocations).toEqual({ Golf: 20000 });
  });

  it("cancels a subscription without deleting it, and deleting it means gone", async () => {
    const s = svc();
    const id = (await s.saveSub(null, { merchantName: "Disney+", amountCents: 3189, frequency: "Monthly", status: "active" }))!;
    await s.saveSub(id, { merchantName: "Disney+", amountCents: 3189, frequency: "Monthly", status: "cancelled" });
    let subs = (await s.load()).subs;
    expect(subs).toHaveLength(1);
    expect(subs[0]!.data.status).toBe("cancelled");
    expect(monthlySubTotal(subs)).toBe(0);

    await s.removeSub(id);
    subs = (await s.load()).subs;
    expect(subs).toHaveLength(0);
  });

  it("an import on top of a hand-made account does not duplicate it", async () => {
    const s = svc();
    await s.saveAccount(null, {
      name: "PLATINUM CARD ...4975", type: "credit card",
      currentBalanceCents: 1, availableBalanceCents: 2,
    });
    expect(await s.seedIfEmpty()).toBe(true);
    const { accounts } = await s.load();
    expect(accounts.filter((a) => a.data.name === "PLATINUM CARD ...4975")).toHaveLength(1);
    expect(accounts).toHaveLength(4);
  });
});
