import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { MoneyService } from "./MoneyService";
import { totalBalance, formatMoney, signedBalance } from "./types";

describe("MoneyService", () => {
  it("creates accounts, totals balances, edits, removes", async () => {
    const m = new MoneyService(new Store(new InMemoryAdapter()), "u");
    await m.create({ name: "Checking", balance: 1200, kind: "cash" });
    const id = await m.create({ name: "Card", balance: -300, kind: "credit" });
    const list = await m.list();
    expect(totalBalance(list)).toBe(900);
    await m.update(id!, { balance: -100 });
    expect(totalBalance(await m.list())).toBe(1100);
    await m.remove(id!);
    expect((await m.list()).length).toBe(1);
  });
  // HMN-F-13 (2026-09-05), option A: a credit account is money owed. The
  // iPhone's numeric keypad has no minus, so the debt is typed as a plain
  // positive number and the total subtracts it. A record written the old way
  // (a negative, typed on a hardware keyboard) means the same thing.
  it("a credit account is subtracted whichever way its amount was typed", async () => {
    const m = new MoneyService(new Store(new InMemoryAdapter()), "u");
    await m.create({ name: "Checking", balance: 1200, kind: "cash" });
    await m.create({ name: "Card", balance: 2000, kind: "credit" });
    expect(totalBalance(await m.list())).toBe(-800);
    expect(signedBalance({ name: "Card", balance: 2000, kind: "credit" })).toBe(-2000);
    // The older shape reads identically, so nothing stored has to be migrated.
    expect(signedBalance({ name: "Card", balance: -2000, kind: "credit" })).toBe(-2000);
    // And every other kind keeps its own sign, including a real overdraft.
    expect(signedBalance({ name: "Checking", balance: -40, kind: "cash" })).toBe(-40);
  });

  it("rejects empty name; formats USD", async () => {
    const m = new MoneyService(new Store(new InMemoryAdapter()), "u");
    expect(await m.create({ name: "  ", balance: 5, kind: "cash" })).toBeNull();
    expect(formatMoney(1500)).toBe("$1,500");
  });

  // HMN-F-25 (2026-09-05), option B: the bill sheet takes cents and the
  // display dropped them, so a $49.99 bill read "$50" and a card of them
  // summed to a total that did not match its own rows.
  it("shows cents only when the number carries them", () => {
    expect(formatMoney(49.99)).toBe("$49.99");
    expect(formatMoney(12.5)).toBe("$12.50");
    expect(formatMoney(-49.99)).toBe("-$49.99");
    // A whole number never grows a ".00" it never had.
    expect(formatMoney(50)).toBe("$50");
    expect(formatMoney(0)).toBe("$0");
  });
});
