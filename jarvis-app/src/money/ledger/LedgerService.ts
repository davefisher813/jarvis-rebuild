import type { Store, ItemData } from "@core";
import { addDays } from "../../schedule/calendar";
import { ENTITY_MONEY_TX, type TrackerTx, type TrackerTxData } from "../tracker";
import { assertWritable, buildBill, confirmRecurrence, correctBill, markPaid, unmarkPaid, type BillCorrection, type BillInput } from "./bill";
import { parseCents } from "./cents";
import { isRealDate } from "./dates";
import { findDuplicate, fingerprintOf } from "./fingerprint";
import { appended, diffFields, entry, isoNow, type Clock } from "./history";
import { linkBill, linkReceipt, proposeBillMatches, proposeReceiptMatches, unlinkReceipt, type MatchProposal, type TxLike } from "./reconcile";
import { billStatus } from "./status";
import { checkCore, optionalDate } from "./validate";
import {
  ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT,
  type Bill, type BillData, type BillRecurrence, type BillSource, type HistoryEntry, type PaidEvidence, type Receipt, type ReceiptData, type ReceiptSource,
} from "./types";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

export type AddResult = { ok: true; id: string; duplicate: boolean } | { ok: false; errors: string[] };
export type WriteResult = { ok: true } | { ok: false; reason: string };

// THE LEDGER'S STORE (spec sections 3 to 5).
//
// Every rule lives in the pure files beside this one; this class loads, asks
// them, and writes the answer, history included, in ONE patch per record. It
// decides nothing and calls no model, so everything here works with every AI
// feature off (the AI-off test drives exactly this class).
export class LedgerService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: Emit = () => {},
    private now: Clock = isoNow,
  ) {}

  // ---- reads ---------------------------------------------------------------

  async listBills(): Promise<Bill[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_MONEY_BILL);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as BillData }));
  }
  async getBill(id: string): Promise<Bill | null> {
    const it = await this.store.read(this.ownerId, id);
    return it && it.entityType === ENTITY_MONEY_BILL ? { id: it.id, data: it.data as unknown as BillData } : null;
  }
  async listReceipts(): Promise<Receipt[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_MONEY_RECEIPT);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as ReceiptData }));
  }
  async getReceipt(id: string): Promise<Receipt | null> {
    const it = await this.store.read(this.ownerId, id);
    return it && it.entityType === ENTITY_MONEY_RECEIPT ? { id: it.id, data: it.data as unknown as ReceiptData } : null;
  }
  async listTxs(): Promise<TrackerTx[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_MONEY_TX);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as TrackerTxData }));
  }
  private async getTx(id: string): Promise<TrackerTx | null> {
    const it = await this.store.read(this.ownerId, id);
    return it && it.entityType === ENTITY_MONEY_TX ? { id: it.id, data: it.data as unknown as TrackerTxData } : null;
  }

  // ---- writes: one place each, so a rule cannot be skipped -----------------

  /** Write a record's next state. A key the next state no longer has goes out
   *  as undefined, which the Store sends as null, which clears it on the server
   *  (SCHED-F-01): a bare merge of `next` would leave the old paid date behind. */
  private async put(entityType: string, id: string, next: unknown, before?: unknown): Promise<void> {
    const patch: Record<string, unknown> = { ...(next as Record<string, unknown>) };
    for (const k of Object.keys((before ?? {}) as Record<string, unknown>)) if (!(k in patch)) patch[k] = undefined;
    await this.store.update(this.ownerId, id, patch as ItemData);
    this.onEvent({ type: "entity.updated", entityType, entityId: id });
  }

  // ---- bills ---------------------------------------------------------------

  /** Add a bill. An exact duplicate (same vendor, amount, due date and source)
   *  is not added: the existing one is returned with `duplicate: true`. */
  async addBill(input: BillInput, source: BillSource = "manual", by: HistoryEntry["by"] = source === "manual" ? "user" : "email", id?: string): Promise<AddResult> {
    const built = buildBill(input, source, by, this.now);
    if (!built.ok) return built;
    const dup = findDuplicate(await this.listBills(), built.value.fingerprint);
    if (dup) return { ok: true, id: dup.id, duplicate: true };
    const made = await this.store.create(this.ownerId, ENTITY_MONEY_BILL, built.value as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONEY_BILL, entityId: made });
    return { ok: true, id: made, duplicate: false };
  }

  /** Correct a bill; what changed is written to its history. Correcting a paid
   *  bill's amount, vendor, currency or due date puts the paid state back to
   *  "needs confirming". */
  async correctBill(id: string, c: BillCorrection): Promise<WriteResult & { changed?: boolean }> {
    const cur = await this.getBill(id);
    if (!cur) return { ok: false, reason: "missing" };
    const r = correctBill(cur.data, c, "user", this.now);
    if (!r.ok) return { ok: false, reason: "invalid:" + r.errors.join(",") };
    if (!r.value.changed) return { ok: true, changed: false };
    const w = assertWritable(r.value.next);
    if (!w.ok) return w;
    await this.put(ENTITY_MONEY_BILL, id, r.value.next, cur.data);
    return { ok: true, changed: true };
  }

  /** Mark paid, the ONLY way a bill becomes paid. Without evidence it fails
   *  and writes nothing. */
  async markBillPaid(id: string, evidence: PaidEvidence | null | undefined, paidAt: string | null | undefined): Promise<WriteResult> {
    const cur = await this.getBill(id);
    if (!cur) return { ok: false, reason: "missing" };
    const r = markPaid(cur.data, evidence, paidAt, "user", this.now);
    if (!r.ok) return r;
    const w = assertWritable(r.next);
    if (!w.ok) return w;
    await this.put(ENTITY_MONEY_BILL, id, r.next, cur.data);
    // A bill the person confirmed as recurring has its next one scheduled when
    // this one is paid. An unconfirmed bill never does (spec section 3).
    await this.rollRecurring(r.next);
    return { ok: true };
  }

  /** "I paid this": the person's own confirmation, dated the day they say so. */
  markBillPaidByUser(id: string, paidAt: string): Promise<WriteResult> {
    return this.markBillPaid(id, { type: "user_confirmed" }, paidAt);
  }

  async unmarkBillPaid(id: string): Promise<WriteResult> {
    const cur = await this.getBill(id);
    if (!cur) return { ok: false, reason: "missing" };
    const next = unmarkPaid(cur.data, "user", this.now);
    await this.put(ENTITY_MONEY_BILL, id, next, cur.data);
    // A payment that was this bill's evidence is no longer linked to it.
    if (cur.data.paidEvidence?.type === "transaction") {
      const tx = await this.getTx(cur.data.paidEvidence.transactionId);
      if (tx && tx.data.paysBillId === id) {
        await this.put(ENTITY_MONEY_TX, tx.id, { paysBillId: null, history: appended(tx.data.history, entry("user", "unmatched", { paysBillId: { from: id } }, this.now)) });
      }
    }
    return { ok: true };
  }

  async confirmBillRecurrence(id: string, recurrence: BillRecurrence): Promise<WriteResult> {
    const cur = await this.getBill(id);
    if (!cur) return { ok: false, reason: "missing" };
    await this.put(ENTITY_MONEY_BILL, id, confirmRecurrence(cur.data, recurrence, this.now), cur.data);
    return { ok: true };
  }

  /** Remove a bill. Returns the snapshot so the caller can offer Undo. */
  async removeBill(id: string): Promise<Bill | null> {
    const cur = await this.getBill(id);
    if (!cur) return null;
    if (cur.data.paidEvidence?.type === "transaction") {
      const tx = await this.getTx(cur.data.paidEvidence.transactionId);
      if (tx && tx.data.paysBillId === id) await this.put(ENTITY_MONEY_TX, tx.id, { paysBillId: null, history: appended(tx.data.history, entry("user", "unmatched", { paysBillId: { from: id } }, this.now)) });
    }
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_MONEY_BILL, entityId: id });
    return cur;
  }

  /** Undo of a remove: the same record back under the same id. */
  async restoreBill(b: Bill): Promise<void> {
    await this.store.create(this.ownerId, ENTITY_MONEY_BILL, b.data as unknown as ItemData, b.id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONEY_BILL, entityId: b.id });
  }

  /** Bills past an explicit due date and not paid, as of `today`. */
  async overdue(today: string): Promise<Bill[]> {
    return (await this.listBills()).filter((b) => billStatus(b.data, today) === "overdue");
  }

  // ---- receipts ------------------------------------------------------------

  /** Save a receipt. An exact duplicate returns the existing record. */
  async addReceipt(
    input: { vendor?: string; amount?: string | number | null; currency?: string | null; transactionDate?: string | null; category?: string | null; attachmentFileId?: string | null },
    source: ReceiptSource = "manual",
    today: string,
    id?: string,
  ): Promise<AddResult> {
    const core = checkCore(input);
    const date = optionalDate(input.transactionDate);
    const errors = core.ok ? [] : [...core.errors];
    if (!date.ok) errors.push("transactionDate");
    if (errors.length || !core.ok || !date.ok) return { ok: false, errors };
    // The one default the spec allows: a manual receipt is today unless edited.
    const transactionDate = date.value ?? today;
    if (!isRealDate(transactionDate)) return { ok: false, errors: ["transactionDate"] };
    const category = input.category?.trim();
    const attachmentFileId = input.attachmentFileId?.trim();
    const by: HistoryEntry["by"] = typeof source === "string" ? "user" : "email";
    const data: ReceiptData = {
      ...core.value,
      transactionDate,
      ...(category ? { category } : {}),
      ...(attachmentFileId ? { attachmentFileId } : {}),
      source,
      fingerprint: fingerprintOf({ kind: "receipt", vendor: core.value.vendor, amountCents: core.value.amountCents, date: transactionDate, source }),
      history: [entry(by, typeof source === "string" ? "created" : "created from an email", undefined, this.now)],
    };
    const dup = findDuplicate(await this.listReceipts(), data.fingerprint);
    if (dup) return { ok: true, id: dup.id, duplicate: true };
    const made = await this.store.create(this.ownerId, ENTITY_MONEY_RECEIPT, data as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONEY_RECEIPT, entityId: made });
    return { ok: true, id: made, duplicate: false };
  }

  async correctReceipt(id: string, c: { vendor?: string; amount?: string | number | null; transactionDate?: string | null; category?: string | null; attachmentFileId?: string | null }): Promise<WriteResult> {
    const cur = await this.getReceipt(id);
    if (!cur) return { ok: false, reason: "missing" };
    const before = cur.data;
    const next: ReceiptData = { ...before };
    if (c.vendor !== undefined) { const v = c.vendor.trim(); if (!v) return { ok: false, reason: "invalid:vendor" }; next.vendor = v; }
    if (c.amount !== undefined) { const cents = parseCents(c.amount); if (cents === null) return { ok: false, reason: "invalid:amount" }; next.amountCents = cents; }
    if (c.transactionDate !== undefined) {
      const d = optionalDate(c.transactionDate);
      if (!d.ok || !d.value) return { ok: false, reason: "invalid:transactionDate" }; // a receipt always has a date
      next.transactionDate = d.value;
    }
    if (c.category !== undefined) { const t = c.category?.trim(); if (t) next.category = t; else delete next.category; }
    // A photo or file can be added to a receipt typed first, or taken off.
    if (c.attachmentFileId !== undefined) { const f = c.attachmentFileId?.trim(); if (f) next.attachmentFileId = f; else delete next.attachmentFileId; }
    const changes = diffFields(before, next, ["vendor", "amountCents", "transactionDate", "category", "attachmentFileId"]);
    if (!Object.keys(changes).length) return { ok: true };
    next.fingerprint = fingerprintOf({ kind: "receipt", vendor: next.vendor, amountCents: next.amountCents, date: next.transactionDate, source: next.source });
    next.history = appended(before.history, entry("user", "corrected", changes, this.now));
    await this.put(ENTITY_MONEY_RECEIPT, id, next, before);
    return { ok: true };
  }

  async removeReceipt(id: string): Promise<Receipt | null> {
    const cur = await this.getReceipt(id);
    if (!cur) return null;
    if (cur.data.linkedTransactionId) {
      const tx = await this.getTx(cur.data.linkedTransactionId);
      if (tx && tx.data.matchedReceiptId === id) {
        await this.put(ENTITY_MONEY_TX, tx.id, { matchedReceiptId: null, history: appended(tx.data.history, entry("user", "unmatched", { matchedReceiptId: { from: id } }, this.now)) });
      }
    }
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_MONEY_RECEIPT, entityId: id });
    return cur;
  }

  async restoreReceipt(r: Receipt): Promise<void> {
    await this.store.create(this.ownerId, ENTITY_MONEY_RECEIPT, r.data as unknown as ItemData, r.id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONEY_RECEIPT, entityId: r.id });
  }

  // ---- reconciliation: proposals read, approvals write ---------------------

  async receiptMatches(): Promise<MatchProposal[]> {
    return proposeReceiptMatches(await this.listReceipts(), await this.listTxs() as TxLike[]);
  }
  async billMatches(): Promise<MatchProposal[]> {
    return proposeBillMatches(await this.listBills(), await this.listTxs() as TxLike[]);
  }

  /** The person approved this match. Both sides are rechecked first, so a
   *  proposal that went stale (the transaction was matched elsewhere) is
   *  refused rather than double-linked. */
  async approveReceiptMatch(receiptId: string, txId: string): Promise<WriteResult> {
    const [r, t] = await Promise.all([this.getReceipt(receiptId), this.getTx(txId)]);
    if (!r || !t) return { ok: false, reason: "missing" };
    const res = linkReceipt(receiptId, r.data, t as TxLike, this.now);
    if (!res.ok) return res;
    await this.put(ENTITY_MONEY_RECEIPT, receiptId, res.receipt, r.data);
    await this.put(ENTITY_MONEY_TX, txId, res.txPatch);
    return { ok: true };
  }

  async unmatchReceipt(receiptId: string): Promise<WriteResult> {
    const r = await this.getReceipt(receiptId);
    if (!r || !r.data.linkedTransactionId) return { ok: false, reason: "missing" };
    const t = await this.getTx(r.data.linkedTransactionId);
    const res = unlinkReceipt(r.data, t as TxLike | null ?? undefined, this.now);
    await this.put(ENTITY_MONEY_RECEIPT, receiptId, res.receipt, r.data);
    if (t && res.txPatch) await this.put(ENTITY_MONEY_TX, t.id, res.txPatch);
    return { ok: true };
  }

  async approveBillMatch(billId: string, txId: string): Promise<WriteResult> {
    const [b, t] = await Promise.all([this.getBill(billId), this.getTx(txId)]);
    if (!b || !t) return { ok: false, reason: "missing" };
    const res = linkBill(billId, b.data, t as TxLike, this.now);
    if (!res.ok) return res;
    const w = assertWritable(res.bill);
    if (!w.ok) return w;
    await this.put(ENTITY_MONEY_BILL, billId, res.bill, b.data);
    await this.put(ENTITY_MONEY_TX, txId, res.txPatch);
    await this.rollRecurring(res.bill);
    return { ok: true };
  }

  /** Schedule the next occurrence of a bill whose recurrence the person
   *  confirmed. An exact repeat (same vendor, amount, next due date) is the
   *  fingerprint's to suppress, so paying, undoing and paying again adds one. */
  private async rollRecurring(paid: BillData): Promise<void> {
    if (!paid.recurrence || !paid.dueDate) return;
    const next: BillInput = {
      vendor: paid.vendor,
      amount: paid.amountCents / 100,
      currency: paid.currency,
      dueDate: LedgerService.nextDue(paid.dueDate, paid.recurrence),
      ...(paid.autopay ? { autopay: true } : {}),
      ...(paid.payUrl ? { payUrl: paid.payUrl } : {}),
      ...(paid.notes ? { notes: paid.notes } : {}),
      recurrence: paid.recurrence,
    };
    await this.addBill(next, "manual", "user");
  }

  /** The next due date for a confirmed recurring bill, for the roll-forward a
   *  later change adds. Pure date math only; never called on an unconfirmed bill. */
  static nextDue(due: string, r: BillRecurrence): string {
    if (r === "weekly") return addDays(due, 7);
    const [y, m, d] = due.split("-").map(Number) as [number, number, number];
    const target = r === "monthly" ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y + 1, m - 1, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(d, last);
    return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
}
