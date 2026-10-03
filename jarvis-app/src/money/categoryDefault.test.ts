import { describe, it, expect } from "vitest";
import { categoryChoices, lastCategoryFor } from "./categoryDefault";

const tx = (merchant: string, date: string, category: string) => ({ data: { merchant, date, category } });
const rc = (vendor: string, transactionDate: string, category?: string) => ({ data: { vendor, transactionDate, category } });

describe("the category a vendor usually gets", () => {
  it("is the vendor's most recent real category, across transactions and receipts", () => {
    const txs = [tx("Stop & Shop", "2026-09-01", "Groceries"), tx("Stop & Shop", "2026-09-20", "Household")];
    expect(lastCategoryFor("Stop & Shop", txs, [])).toBe("Household");
    // a newer receipt wins over an older payment
    expect(lastCategoryFor("Stop & Shop", txs, [rc("Stop & Shop", "2026-10-01", "Groceries")])).toBe("Groceries");
  });

  it("matches the vendor the way matching does: punctuation and case do not matter", () => {
    expect(lastCategoryFor("STOP  SHOP", [tx("Stop & Shop", "2026-09-01", "Groceries")], [])).toBe("Groceries");
  });

  it("ignores no-choice values: blank, Other, Income and Uncategorized", () => {
    const txs = [tx("Cafe", "2026-09-01", "Dining"), tx("Cafe", "2026-09-05", "Other"), tx("Cafe", "2026-09-06", "Income")];
    // the newer rows say nothing about the vendor, so the real choice stands
    expect(lastCategoryFor("Cafe", txs, [rc("Cafe", "2026-09-07"), rc("Cafe", "2026-09-08", "Uncategorized")])).toBe("Dining");
  });

  it("is undefined for a new vendor or a blank one: no guess, no model", () => {
    expect(lastCategoryFor("Brand New", [tx("Cafe", "2026-09-01", "Dining")], [])).toBeUndefined();
    expect(lastCategoryFor("   ", [tx("Cafe", "2026-09-01", "Dining")], [])).toBeUndefined();
    expect(lastCategoryFor("Cafe", [], [])).toBeUndefined();
  });

  it("a tie on the day goes to the later record in the list", () => {
    const txs = [tx("Cafe", "2026-09-01", "Dining"), tx("Cafe", "2026-09-01", "Fun")];
    expect(lastCategoryFor("Cafe", txs, [])).toBe("Fun");
  });
});

describe("the names a category picker offers", () => {
  it("lists what has been used first, then the proposed names not already there", () => {
    const got = categoryChoices({
      txs: [{ data: { category: "Restaurants" } }, { data: { category: "Income" } }],
      receipts: [{ data: { category: "Groceries" } }, { data: {} }],
      budgetNames: ["Pets"],
    });
    expect(got.slice(0, 3)).toEqual(["Groceries", "Pets", "Restaurants"]);
    expect(got).not.toContain("Income");
    expect(got).not.toContain("Uncategorized");
    // Groceries was used, so it is not offered twice as a proposal
    expect(got.filter((c) => c === "Groceries")).toHaveLength(1);
    expect(got).toContain("Kids/Family");
    expect(got).toContain("Dining");
  });

  it("is the nine proposals and nothing else for a brand new person", () => {
    expect(categoryChoices({})).toHaveLength(9);
  });

  it("dedupes case-insensitively", () => {
    const got = categoryChoices({ txs: [{ data: { category: "groceries" } }, { data: { category: "Groceries" } }] });
    expect(got.filter((c) => c.toLowerCase() === "groceries")).toHaveLength(1);
  });
});
