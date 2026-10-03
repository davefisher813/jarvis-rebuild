import { describe, it, expect } from "vitest";
import { assertWritable, buildBill, confirmRecurrence, correctBill, markPaid, unmarkPaid } from "./bill";
import { billStatus } from "./status";
import type { BillData } from "./types";

const NOW = () => "2026-10-02T12:00:00.000Z";
const made = (over: Parameters<typeof buildBill>[0] = {}, src: Parameters<typeof buildBill>[1] = "manual", by: Parameters<typeof buildBill>[2] = "user") => {
  const r = buildBill({ vendor: "ConEdison", amount: "84.12", dueDate: "2026-10-15", ...over }, src, by, NOW);
  if (!r.ok) throw new Error("fixture: " + r.errors.join());
  return r.value;
};

describe("buildBill", () => {
  it("builds the spec's record: cents, USD, fingerprint, one history line", () => {
    const b = made();
    expect(b).toMatchObject({ vendor: "ConEdison", amountCents: 8412, currency: "USD", dueDate: "2026-10-15", source: "manual" });
    expect(b.fingerprint).toBe("bill|conedison|8412|2026-10-15|local");
    expect(b.history).toEqual([{ at: "2026-10-02T12:00:00.000Z", by: "user", action: "created" }]);
    expect(b.paidAt).toBeUndefined();
  });
  it("names what failed and writes nothing", () => {
    expect(buildBill({ vendor: "", amount: "0", currency: "NOPE", dueDate: "2026-02-31" }, "manual", "user", NOW))
      .toEqual({ ok: false, errors: ["vendor", "amount", "currency", "dueDate"] });
  });
  it("no due date stays no due date (rule 3)", () => {
    const b = made({ dueDate: "" });
    expect("dueDate" in b).toBe(false);
    expect(billStatus(b, "2099-01-01")).toBe("unpaid");
  });
  it("an email bill keeps its message as its source and cannot set a recurrence", () => {
    const b = made({ recurrence: "monthly" }, { type: "email", fingerprint: "msg-1", ref: "thread-9" }, "email");
    expect(b.source).toEqual({ type: "email", fingerprint: "msg-1", ref: "thread-9" });
    expect(b.recurrence).toBeUndefined();
    expect(b.history[0]!.by).toBe("email");
    expect(b.fingerprint).toBe("bill|conedison|8412|2026-10-15|email:msg-1");
  });
  it("a person can choose a recurrence on the sheet", () => {
    expect(made({ recurrence: "monthly" }).recurrence).toBe("monthly");
    expect(made({ recurrence: "daily" as never }).recurrence).toBeUndefined();
  });
});

describe("markPaid: no evidence, no paid (rule 2, acceptance 2)", () => {
  it("refuses without evidence, and the bill is unchanged", () => {
    const b = made();
    expect(markPaid(b, undefined, "2026-10-02")).toEqual({ ok: false, reason: "evidence_required" });
    expect(markPaid(b, null, "2026-10-02")).toEqual({ ok: false, reason: "evidence_required" });
  });
  it("refuses malformed evidence", () => {
    const b = made();
    expect(markPaid(b, { type: "transaction", transactionId: "" }, "2026-10-02")).toEqual({ ok: false, reason: "bad_evidence" });
    expect(markPaid(b, { type: "confirmation", fingerprint: "" }, "2026-10-02")).toEqual({ ok: false, reason: "bad_evidence" });
    expect(markPaid(b, { type: "probably" } as never, "2026-10-02")).toEqual({ ok: false, reason: "bad_evidence" });
  });
  it("needs an explicit, real paid date", () => {
    const b = made();
    expect(markPaid(b, { type: "user_confirmed" }, undefined)).toEqual({ ok: false, reason: "paid_date_required" });
    expect(markPaid(b, { type: "user_confirmed" }, "2026-02-31")).toEqual({ ok: false, reason: "paid_date_required" });
  });
  it("user confirmation and a transaction both work, and the history says which", () => {
    const b = made();
    const u = markPaid(b, { type: "user_confirmed" }, "2026-10-02", "user", NOW);
    expect(u.ok && u.next).toMatchObject({ paidAt: "2026-10-02", paidEvidence: { type: "user_confirmed" } });
    const t = markPaid(b, { type: "transaction", transactionId: "tx1" }, "2026-10-14", "user", NOW);
    expect(t.ok && t.next.paidEvidence).toEqual({ type: "transaction", transactionId: "tx1" });
    expect(t.ok && t.next.history.at(-1)).toMatchObject({ action: "marked paid", by: "user" });
    expect(t.ok && billStatus(t.next, "2026-10-20")).toBe("paid");
  });
  it("assertWritable is the second wall against a paid date with no evidence", () => {
    const b = made();
    expect(assertWritable({ ...b, paidAt: "2026-10-02" })).toEqual({ ok: false, reason: "evidence_required" });
    expect(assertWritable({ ...b, paidEvidence: { type: "user_confirmed" } })).toEqual({ ok: false, reason: "paid_date_required" });
    expect(assertWritable(b)).toEqual({ ok: true });
  });
  it("unmark takes the paid state off and says so in the history", () => {
    const paid = markPaid(made(), { type: "user_confirmed" }, "2026-10-02", "user", NOW);
    const back = unmarkPaid((paid as { next: BillData }).next, "user", NOW);
    expect(back.paidAt).toBeUndefined();
    expect(back.paidEvidence).toBeUndefined();
    expect(back.history.at(-1)!.action).toBe("paid state removed");
  });
});

describe("correctBill: a versioned update that shows what changed", () => {
  it("records the before and after of exactly the fields that moved", () => {
    const b = made();
    const r = correctBill(b, { amount: "90", notes: "  new rate " }, "user", NOW);
    expect(r.ok && r.value.next.amountCents).toBe(9000);
    expect(r.ok && r.value.next.history.at(-1)).toEqual({
      at: "2026-10-02T12:00:00.000Z", by: "user", action: "corrected",
      changes: { amountCents: { from: 8412, to: 9000 }, notes: { to: "new rate" } },
    });
    expect(r.ok && r.value.next.fingerprint).toBe("bill|conedison|9000|2026-10-15|local");
  });
  it("a correction that changes nothing writes nothing", () => {
    const b = made();
    const r = correctBill(b, { amount: "84.12", vendor: "ConEdison" }, "user", NOW);
    expect(r.ok && r.value.changed).toBe(false);
  });
  it("refuses a bad amount, date or currency and names it", () => {
    expect(correctBill(made(), { amount: "x" })).toEqual({ ok: false, errors: ["amount"] });
    expect(correctBill(made(), { dueDate: "2026-13-40" })).toEqual({ ok: false, errors: ["dueDate"] });
    expect(correctBill(made(), { currency: "QQQ" })).toEqual({ ok: false, errors: ["currency"] });
  });
  it("clearing the due date leaves it blank, not guessed", () => {
    const r = correctBill(made(), { dueDate: "" }, "user", NOW);
    expect(r.ok && "dueDate" in r.value.next).toBe(false);
  });
  it("correcting a PAID bill's amount asks for the paid state again", () => {
    const paid = (markPaid(made(), { type: "user_confirmed" }, "2026-10-02", "user", NOW) as { next: BillData }).next;
    const r = correctBill(paid, { amount: "99" }, "user", NOW);
    expect(r.ok && r.value.next.paidNeedsReconfirm).toBe(true);
    expect(r.ok && billStatus(r.value.next, "2026-10-02")).toBe("unpaid"); // 13 days out, by its dates
    expect(r.ok && r.value.next.history.at(-1)!.action).toBe("corrected, paid state needs confirming");
    // confirming again clears it
    const again = markPaid((r as { ok: true; value: { next: BillData } }).value.next, { type: "user_confirmed" }, "2026-10-03", "user", NOW);
    expect(again.ok && again.next.paidNeedsReconfirm).toBeUndefined();
    expect(again.ok && billStatus(again.next, "2026-10-03")).toBe("paid");
  });
  it("a note on a paid bill does not reopen it", () => {
    const paid = (markPaid(made(), { type: "user_confirmed" }, "2026-10-02", "user", NOW) as { next: BillData }).next;
    const r = correctBill(paid, { notes: "thanks" }, "user", NOW);
    expect(r.ok && r.value.next.paidNeedsReconfirm).toBeUndefined();
  });
  it("recurrence is confirmed, never inferred", () => {
    const b = confirmRecurrence(made(), "monthly", NOW);
    expect(b.recurrence).toBe("monthly");
    expect(b.history.at(-1)).toMatchObject({ action: "recurrence confirmed", changes: { recurrence: { to: "monthly" } } });
  });
});
