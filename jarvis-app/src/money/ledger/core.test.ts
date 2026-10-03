import { describe, it, expect } from "vitest";
import { parseCents, centsToField } from "./cents";
import { isRealDate, dayGap } from "./dates";
import { billStatus, overdueBills, daysLate, isPaid } from "./status";
import { normalizeVendor, fingerprintOf, sourceKey, findDuplicate } from "./fingerprint";
import { checkCore, cleanCurrency, isCurrencyCode, optionalDate } from "./validate";
import { suggestMonthly } from "./recurring";
import type { BillData } from "./types";

const TODAY = "2026-10-02";

describe("parseCents: a typed amount is money or it is nothing", () => {
  it("reads plain amounts to the cent", () => {
    expect(parseCents("12")).toBe(1200);
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents("$1,234.50")).toBe(123450);
    expect(parseCents(".99")).toBe(99);
    expect(parseCents(84.12)).toBe(8412);
    // float noise from arithmetic is not a third decimal
    expect(parseCents(0.1 + 0.2)).toBe(30);
  });
  it("refuses everything that is not a plain positive amount", () => {
    for (const bad of ["", "abc", "12x", "-5", "0", "0.00", "1.234", "1e5", "$", NaN, Infinity, -1, 0, null, undefined, 12.345]) {
      expect(parseCents(bad as never), String(bad)).toBeNull();
    }
    expect(parseCents("99999999999")).toBeNull();
  });
  it("shows cents back as a field value", () => {
    expect(centsToField(1250)).toBe("12.50");
    expect(centsToField(5)).toBe("0.05");
  });
});

describe("dates: explicit and real, never guessed", () => {
  it("knows a real day from a plausible string", () => {
    expect(isRealDate("2026-10-02")).toBe(true);
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-2-3")).toBe(false);
    expect(isRealDate("")).toBe(false);
    expect(isRealDate(undefined)).toBe(false);
  });
  it("counts whole days across months and DST", () => {
    expect(dayGap("2026-10-02", "2026-10-09")).toBe(7);
    expect(dayGap("2026-03-07", "2026-03-09")).toBe(2);
    expect(dayGap("2026-11-01", "2026-10-30")).toBe(-2);
  });
  it("an optional date: blank stays blank, junk is refused, never defaulted", () => {
    expect(optionalDate("")).toEqual({ ok: true, value: undefined });
    expect(optionalDate(null)).toEqual({ ok: true, value: undefined });
    expect(optionalDate("2026-10-31")).toEqual({ ok: true, value: "2026-10-31" });
    expect(optionalDate("soon")).toEqual({ ok: false });
    expect(optionalDate("2026-02-30")).toEqual({ ok: false });
  });
});

describe("billStatus: computed from explicit dates and evidence only", () => {
  const unpaid = (dueDate?: string) => ({ dueDate });
  it("unpaid, due (within 7 days, inclusive), overdue", () => {
    expect(billStatus(unpaid("2026-10-20"), TODAY)).toBe("unpaid");
    expect(billStatus(unpaid("2026-10-09"), TODAY)).toBe("due");   // exactly 7 days
    expect(billStatus(unpaid("2026-10-10"), TODAY)).toBe("unpaid"); // 8 days
    expect(billStatus(unpaid(TODAY), TODAY)).toBe("due");
    expect(billStatus(unpaid("2026-10-01"), TODAY)).toBe("overdue");
  });
  it("a bill with no due date is never due and never overdue (acceptance 6)", () => {
    expect(billStatus(unpaid(undefined), TODAY)).toBe("unpaid");
    expect(billStatus(unpaid(undefined), "2099-01-01")).toBe("unpaid");
    expect(billStatus({ dueDate: "not a date" }, TODAY)).toBe("unpaid");
    expect(daysLate(unpaid(undefined), TODAY)).toBeNull();
  });
  it("paid needs a paid date AND evidence; a bare paid date is not paid (rule 2)", () => {
    expect(billStatus({ dueDate: "2026-09-01", paidAt: TODAY }, TODAY)).toBe("overdue");
    expect(billStatus({ dueDate: "2026-09-01", paidEvidence: { type: "user_confirmed" } }, TODAY)).toBe("overdue");
    expect(billStatus({ dueDate: "2026-09-01", paidAt: TODAY, paidEvidence: { type: "user_confirmed" } }, TODAY)).toBe("paid");
  });
  it("a paid bill waiting on re-confirmation reads by its dates again", () => {
    const b = { dueDate: "2026-09-01", paidAt: TODAY, paidEvidence: { type: "user_confirmed" as const }, paidNeedsReconfirm: true as const };
    expect(isPaid(b)).toBe(false);
    expect(billStatus(b, TODAY)).toBe("overdue");
  });
  it("overdueBills is the one overdue set; daysLate words it", () => {
    const mk = (id: string, dueDate?: string, paid = false) => ({ id, data: { dueDate, ...(paid ? { paidAt: TODAY, paidEvidence: { type: "user_confirmed" as const } } : {}) } });
    const set = [mk("a", "2026-09-30"), mk("b"), mk("c", "2026-10-05"), mk("d", "2026-09-01", true)];
    expect(overdueBills(set, TODAY).map((x) => x.id)).toEqual(["a"]);
    expect(daysLate(set[0]!.data, TODAY)).toBe(2);
  });
});

describe("fingerprints: one purchase, one record (rule 4)", () => {
  it("vendors normalise: case, punctuation, spacing", () => {
    expect(normalizeVendor("Stop & Shop!")).toBe("stop shop");
    expect(normalizeVendor("  STOP   SHOP ")).toBe("stop shop");
    expect(normalizeVendor("Con-Edison")).toBe(normalizeVendor("con edison"));
  });
  it("typed and photographed are one source class; an email is its message", () => {
    expect(sourceKey("manual")).toBe(sourceKey("camera"));
    expect(sourceKey({ type: "email", fingerprint: "m1" })).toBe("email:m1");
    expect(sourceKey("manual")).not.toBe(sourceKey("import"));
  });
  it("same vendor, amount, date and source collide; a changed amount or date does not", () => {
    const base = { kind: "receipt" as const, vendor: "Stop & Shop", amountCents: 4712, date: "2026-09-08", source: "manual" as const };
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base, vendor: "stop shop", source: "camera" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, amountCents: 4713 }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, date: "2026-09-09" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, kind: "bill" }));
  });
  it("findDuplicate returns the existing record", () => {
    expect(findDuplicate([{ data: { fingerprint: "a" } }, { data: { fingerprint: "b" } }], "b")).toEqual({ data: { fingerprint: "b" } });
    expect(findDuplicate([{ data: { fingerprint: "a" } }], "z")).toBeUndefined();
  });
});

describe("validation", () => {
  it("rejects invalid currency codes, defaults blank to USD", () => {
    expect(cleanCurrency("")).toBe("USD");
    expect(cleanCurrency(undefined)).toBe("USD");
    expect(cleanCurrency("eur")).toBe("EUR");
    expect(cleanCurrency("XXQ")).toBeNull();
    expect(cleanCurrency("DOLLARS")).toBeNull();
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(false);
  });
  it("names every field that failed, and keeps the vendor as written", () => {
    expect(checkCore({ vendor: "  ", amount: "x", currency: "ZZZ" })).toEqual({ ok: false, errors: ["vendor", "amount", "currency"] });
    const ok = checkCore({ vendor: "  ConEd ", amount: "84.12" });
    expect(ok).toEqual({ ok: true, value: { vendor: "ConEd", amountCents: 8412, currency: "USD" } });
  });
});

describe("recurring suggestions are candidates, from what the bills already show", () => {
  const bill = (id: string, dueDate: string | undefined, amountCents = 8412, extra: Partial<BillData> = {}) => ({
    id,
    data: { vendor: "ConEdison", amountCents, currency: "USD", ...(dueDate ? { dueDate } : {}), source: "manual", fingerprint: id, history: [], ...extra } as BillData,
  });
  it("three consecutive months, same amount: suggest monthly on the latest", () => {
    const s = suggestMonthly([bill("a", "2026-07-20"), bill("b", "2026-08-20"), bill("c", "2026-09-20")]);
    expect(s).toEqual([{ vendor: "ConEdison", amountCents: 8412, recurrence: "monthly", billId: "c", count: 3 }]);
  });
  it("two is not a pattern; a gap breaks the run; a different amount is another bill", () => {
    expect(suggestMonthly([bill("a", "2026-08-20"), bill("b", "2026-09-20")])).toEqual([]);
    expect(suggestMonthly([bill("a", "2026-06-20"), bill("b", "2026-08-20"), bill("c", "2026-09-20")])).toEqual([]);
    expect(suggestMonthly([bill("a", "2026-07-20"), bill("b", "2026-08-20", 9000), bill("c", "2026-09-20")])).toEqual([]);
  });
  it("bills with no due date take no part, and a confirmed recurring one is not suggested again", () => {
    expect(suggestMonthly([bill("a", undefined), bill("b", undefined), bill("c", undefined)])).toEqual([]);
    expect(suggestMonthly([bill("a", "2026-07-20"), bill("b", "2026-08-20"), bill("c", "2026-09-20", 8412, { recurrence: "monthly" })])).toEqual([]);
  });
});
