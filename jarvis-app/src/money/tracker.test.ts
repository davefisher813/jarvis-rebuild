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
    expect(fmtCents(-4500)).toBe("\u2212$45.00");
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
    expect(categoryColor("Restaurants")).toBe("#4da3ff");
    expect(categoryColor("Overdraft")).toBe("#ff3b30");
    // Stable between renders: the same name is the same colour every time.
    expect(categoryColor("Dog Grooming", 2)).toBe(categoryColor("Dog Grooming", 2));
  });

  // ROUND 2 (2026-10-05): "Spending by Category is an 11-colour rainbow with near-duplicate hues", two reds beside the brand red
  // and three of amber, orange and yellow. Those hues are the Colour Key's (late, due soon), so a category never wears one:
  // Overdraft is the one red, and every other named category and every fallback sits clear of red, orange, amber and yellow.
  it("no category but Overdraft wears the key's red, orange, amber or yellow, and no two named ones share a colour", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 0.08) return -1; // a grey has no hue
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const warm = (h: number) => h >= 0 && (h <= 70 || h >= 345);
    const named = ["Restaurants", "Fast Food", "Supermarkets and Groceries", "Food and Beverage Store", "Golf", "Sporting Goods",
      "Digital Purchase", "Subscription", "Service", "Charities and Non-Profits", "Overdraft", "Other"];
    for (const n of named) {
      if (n === "Overdraft") { expect(warm(hue(categoryColor(n)))).toBe(true); continue; }
      expect(warm(hue(categoryColor(n))), n + " is warm: " + categoryColor(n)).toBe(false);
    }
    expect(new Set(named.map((n) => categoryColor(n))).size).toBe(named.length);
    // An unknown category's stable fallback is clear of the key's warm hues too.
    for (let i = 0; i < 40; i++) expect(warm(hue(categoryColor("Unlisted " + i, i)))).toBe(false);
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

// MONEY LEDGER (2026-10-03): an edit shows in the row's own history, and an
// edit never drops what the ledger linked to it.
describe("TrackerService: transaction history and links", () => {
  const NOW = () => "2026-10-03T10:00:00.000Z";
  const base: TrackerTxData = {
    date: "2026-09-08", month: "2026-09", merchant: "Stop & Shop", name: "Stop & Shop", amountCents: 4712, category: "Groceries", account: "CHK",
  };
  const make = () => {
    const store = new Store(new InMemoryAdapter());
    return { store, s: new TrackerService(store, "u", () => {}, NOW) };
  };

  it("a new row starts its history with 'created' and is typed by hand", async () => {
    const { s } = make();
    await s.saveTx(null, base);
    const t = (await s.load()).txs[0]!;
    expect(t.data.source).toBe("manual");
    expect(t.data.history).toEqual([{ at: NOW(), by: "user", action: "created" }]);
    expect(t.data.fingerprint).toBe("tx|stop shop|4712|2026-09-08|local");
  });

  it("an edit appends what changed, before and after, in the same write", async () => {
    const { s } = make();
    const id = (await s.saveTx(null, base))!;
    await s.saveTx(id, { ...base, amountCents: 6000, category: "Household" });
    const t = (await s.load()).txs[0]!;
    expect(t.data.amountCents).toBe(6000);
    expect(t.data.history).toHaveLength(2);
    expect(t.data.history![1]).toEqual({
      at: NOW(), by: "user", action: "corrected",
      changes: { amountCents: { from: 4712, to: 6000 }, category: { from: "Groceries", to: "Household" } },
    });
    // the fingerprint follows the money
    expect(t.data.fingerprint).toBe("tx|stop shop|6000|2026-09-08|local");
  });

  it("saving with nothing changed adds no history line", async () => {
    const { s } = make();
    const id = (await s.saveTx(null, base))!;
    await s.saveTx(id, { ...base });
    expect((await s.load()).txs[0]!.data.history).toHaveLength(1);
  });

  it("an edit keeps matchedReceiptId, paysBillId, fingerprint, history, currency and source", async () => {
    const { store, s } = make();
    const id = (await s.saveTx(null, base))!;
    // the ledger links and sets a currency, behind the sheet's back
    await store.update("u", id, { matchedReceiptId: "r1", paysBillId: "b1", currency: "CAD", history: [
      { at: NOW(), by: "user", action: "created" }, { at: NOW(), by: "user", action: "matched to a receipt" },
    ] } as never);
    // the sheet sends only the fields it owns (this is what TxSheet builds)
    await s.saveTx(id, { ...base, merchant: "Stop and Shop", amountCents: 5000 });
    const t = (await s.load()).txs[0]!;
    expect(t.data).toMatchObject({ matchedReceiptId: "r1", paysBillId: "b1", currency: "CAD", source: "manual", merchant: "Stop and Shop", amountCents: 5000 });
    expect(t.data.history!.map((h) => h.action)).toEqual(["created", "matched to a receipt", "corrected"]);
    expect(t.data.fingerprint).toBeTruthy();
  });

  it("an edit cannot overwrite a link with a stale copy from the caller", async () => {
    const { store, s } = make();
    const id = (await s.saveTx(null, base))!;
    const stale = (await s.load()).txs[0]!.data;
    await store.update("u", id, { matchedReceiptId: "r1" } as never);
    await s.saveTx(id, { ...stale, category: "Other" });
    expect((await s.load()).txs[0]!.data.matchedReceiptId).toBe("r1");
  });

  it("a restored row (Undo) comes back under its own id with its history and links", async () => {
    const { s } = make();
    const id = (await s.saveTx(null, base))!;
    const gone = (await s.load()).txs[0]!;
    await s.removeTx(id);
    expect((await s.load()).txs).toHaveLength(0);
    await s.restoreTx(gone);
    const back = (await s.load()).txs[0]!;
    expect(back.id).toBe(id);
    expect(back.data.history).toEqual(gone.data.history);
  });
});
