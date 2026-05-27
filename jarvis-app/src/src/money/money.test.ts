import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { MoneyService } from "./MoneyService";
import { totalBalance, formatMoney } from "./types";

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
  it("rejects empty name; formats USD", async () => {
    const m = new MoneyService(new Store(new InMemoryAdapter()), "u");
    expect(await m.create({ name: "  ", balance: 5, kind: "cash" })).toBeNull();
    expect(formatMoney(1500)).toBe("$1,500");
  });
});
