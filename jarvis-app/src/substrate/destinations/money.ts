import type { Store, ItemData } from "@core";
import { LedgerService } from "../../money/ledger/LedgerService";
import { buildBill } from "../../money/ledger/bill";
import { checkCore } from "../../money/ledger/validate";
import { isRealDate } from "../../money/ledger/dates";
import { fingerprintOf } from "../../money/ledger/fingerprint";
import { entry } from "../../money/ledger/history";
import { emailSourceFor, moneyWords } from "../../money/ledger/emailBill";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT, type BillSource, type ReceiptData, type ReceiptSource } from "../../money/ledger/types";
import { ENTITY_MONEY_TX, type TrackerTxData } from "../../money/tracker";
import { monthDay } from "../../money/bills";
import { hashPayload } from "../canonical";
import { CAPTURE_PAYLOAD_VERSION, type BillPayload, type EvidenceField, type Json, type MoneyAmount, type ReceiptPayload } from "../contracts";
import { notPrepared, undoGuard, unsupported, type Committed, type DestinationAdapter, type PrepareContext, type PrepareResult, type UndoCheck } from "./types";

// MONEY'S TWO DOORS (ADAPTER-CONTRACT.md). Bills and receipts go to Money and
// nowhere else. The ledger's own pure rules do the validating (buildBill,
// checkCore, fingerprintOf), so a bill saved from a card is the same record a
// bill typed on the Money screen would be, history line and all. Nothing here
// decides anything the ledger would not.

export const MONEY_ADAPTER_VERSION = "money-ledger-2026-10-02";

/** How many minor-unit digits a currency has, by the platform's own table. */
export function minorUnitScale(currency: string): number | null {
  try {
    const n = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

/** The ledger stores integer cents. Minor units are handed over only for a
 *  currency whose minor unit is a hundredth; a zero amount is refused the way
 *  the ledger refuses it. Anything else stays in Email as a missing detail. */
export function ledgerAmount(a: MoneyAmount): { ok: true; amount: string } | { ok: false; missing: string[] } {
  if (!Number.isSafeInteger(a.minor_units) || a.minor_units <= 0) return { ok: false, missing: ["amount"] };
  if (minorUnitScale(a.currency) !== 2) return { ok: false, missing: ["currency"] };
  return { ok: true, amount: `${Math.floor(a.minor_units / 100)}.${String(a.minor_units % 100).padStart(2, "0")}` };
}

function sourceFor(ctx: PrepareContext): BillSource & ReceiptSource {
  return ctx.threadId ? emailSourceFor(ctx.threadId) : "manual";
}

const BILL_FIELD: Record<string, string> = { vendor: "issuer", amount: "amount", currency: "currency", dueDate: "due_date" };

async function revisionOf(store: Store, ownerId: string, id: string): Promise<number> {
  return (await store.read(ownerId, id))?.serverTime ?? 0;
}

export const billAdapter: DestinationAdapter<BillPayload> = {
  kind: "bill",
  destinationKind: ENTITY_MONEY_BILL,
  moduleVersion: MONEY_ADAPTER_VERSION,

  async prepare(input, _evidence: EvidenceField[], ctx): Promise<PrepareResult<BillPayload>> {
    const missing: string[] = [];
    const issuer = input.issuer.trim();
    if (!issuer) missing.push("issuer");
    const amt = ledgerAmount(input.amount);
    if (!amt.ok) missing.push(...amt.missing);
    if (input.due_date === null && !input.no_due_date_confirmed) missing.push("due_date");
    if (input.due_date !== null && !isRealDate(input.due_date)) missing.push("due_date");
    if (missing.length || !amt.ok) return notPrepared(missing);
    const source = sourceFor(ctx);
    const by = typeof source === "string" ? "user" : "email";
    const built = buildBill(
      { vendor: issuer, amount: amt.amount, currency: input.amount.currency, dueDate: input.due_date, notes: input.invoice_number ? `Invoice ${input.invoice_number}` : null },
      source, by, ctx.now,
    );
    if (!built.ok) return notPrepared(built.errors.map((e) => BILL_FIELD[e] ?? e));
    const data = built.value;
    const money = moneyWords(data.amountCents, data.currency);
    const normalizedPayload: BillPayload = { ...input, issuer, amount: { minor_units: data.amountCents, currency: data.currency } };
    return {
      ok: true,
      kind: "bill",
      destinationKind: ENTITY_MONEY_BILL,
      data: data as unknown as ItemData,
      normalizedPayload,
      displaySummary: `${data.vendor} · ${money} · ${data.dueDate ? "Due " + monthDay(data.dueDate) : "No Due Date"}`,
      exactEffect: `Saved ${money} Bill to Money`,
      payloadHash: await hashPayload(CAPTURE_PAYLOAD_VERSION, normalizedPayload as unknown as Json),
      moduleVersion: MONEY_ADAPTER_VERSION,
    };
  },

  async commit(store, ownerId, prepared, ctx, id): Promise<Committed> {
    const ledger = new LedgerService(store, ownerId, () => {}, ctx.now);
    const p = prepared.normalizedPayload;
    const amt = ledgerAmount(p.amount);
    if (!amt.ok) throw new Error("MISSING_DETAILS:" + amt.missing.join(","));
    const source = sourceFor(ctx);
    const r = await ledger.addBill(
      { vendor: p.issuer, amount: amt.amount, currency: p.amount.currency, dueDate: p.due_date, notes: p.invoice_number ? `Invoice ${p.invoice_number}` : null },
      source, typeof source === "string" ? "user" : "email", id,
    );
    if (!r.ok) throw new Error("MISSING_DETAILS:" + r.errors.join(","));
    const revision = await revisionOf(store, ownerId, r.id);
    if (r.duplicate) return { itemId: r.id, revision, exactEffect: `Already in Money · ${p.issuer} ${moneyWords(p.amount.minor_units, p.amount.currency)}`, duplicateOf: r.id };
    return { itemId: r.id, revision, exactEffect: prepared.exactEffect };
  },

  async canUndo(store, ownerId, itemId, recordedRevision): Promise<UndoCheck> {
    const guard = await undoGuard(store, ownerId, itemId, recordedRevision);
    if (!guard.eligible) return guard;
    const txs = await store.listForUser(ownerId, ENTITY_MONEY_TX);
    if (txs.some((t) => (t.data as unknown as TrackerTxData).paysBillId === itemId)) {
      return { eligible: false, reason: "A Payment Is Linked to This Bill" };
    }
    return { eligible: true, reason: null };
  },
};

export const receiptAdapter: DestinationAdapter<ReceiptPayload> = {
  kind: "receipt",
  destinationKind: ENTITY_MONEY_RECEIPT,
  moduleVersion: MONEY_ADAPTER_VERSION,

  async prepare(input, _evidence: EvidenceField[], ctx): Promise<PrepareResult<ReceiptPayload>> {
    // Money's receipt has no sign and no refund kind yet (ADAPTER-CONTRACT.md,
    // open question for Money). A refund waits in Email rather than being
    // written as a purchase.
    if (input.transaction_type === "refund") return unsupported(["transaction_type"], "Money Doesn't Record Refunds Yet · Kept in Email");
    const missing: string[] = [];
    const merchant = input.merchant.trim();
    if (!merchant) missing.push("merchant");
    const amt = ledgerAmount(input.amount);
    if (!amt.ok) missing.push(...amt.missing);
    if (!isRealDate(input.purchase_date)) missing.push("purchase_date");
    if (missing.length || !amt.ok) return notPrepared(missing);
    const core = checkCore({ vendor: merchant, amount: amt.amount, currency: input.amount.currency });
    if (!core.ok) return notPrepared(core.errors.map((e) => (e === "vendor" ? "merchant" : e)));
    const source = sourceFor(ctx);
    const by = typeof source === "string" ? "user" : "email";
    // Exactly what LedgerService.addReceipt stores; the contract test holds it so.
    const data: ReceiptData = {
      ...core.value,
      transactionDate: input.purchase_date,
      source,
      fingerprint: fingerprintOf({ kind: "receipt", vendor: core.value.vendor, amountCents: core.value.amountCents, date: input.purchase_date, source }),
      history: [entry(by, typeof source === "string" ? "created" : "created from an email", undefined, ctx.now)],
    };
    const money = moneyWords(data.amountCents, data.currency);
    const normalizedPayload: ReceiptPayload = { ...input, merchant, amount: { minor_units: data.amountCents, currency: data.currency } };
    return {
      ok: true,
      kind: "receipt",
      destinationKind: ENTITY_MONEY_RECEIPT,
      data: data as unknown as ItemData,
      normalizedPayload,
      displaySummary: `${data.vendor} · ${money} · ${monthDay(data.transactionDate)}`,
      exactEffect: `Saved ${money} Receipt to Money`,
      payloadHash: await hashPayload(CAPTURE_PAYLOAD_VERSION, normalizedPayload as unknown as Json),
      moduleVersion: MONEY_ADAPTER_VERSION,
    };
  },

  async commit(store, ownerId, prepared, ctx, id): Promise<Committed> {
    const ledger = new LedgerService(store, ownerId, () => {}, ctx.now);
    const p = prepared.normalizedPayload;
    const amt = ledgerAmount(p.amount);
    if (!amt.ok) throw new Error("MISSING_DETAILS:" + amt.missing.join(","));
    const r = await ledger.addReceipt({ vendor: p.merchant, amount: amt.amount, currency: p.amount.currency, transactionDate: p.purchase_date }, sourceFor(ctx), ctx.today, id);
    if (!r.ok) throw new Error("MISSING_DETAILS:" + r.errors.join(","));
    const revision = await revisionOf(store, ownerId, r.id);
    if (r.duplicate) return { itemId: r.id, revision, exactEffect: `Already in Money · ${p.merchant} ${moneyWords(p.amount.minor_units, p.amount.currency)}`, duplicateOf: r.id };
    return { itemId: r.id, revision, exactEffect: prepared.exactEffect };
  },

  async canUndo(store, ownerId, itemId, recordedRevision): Promise<UndoCheck> {
    const guard = await undoGuard(store, ownerId, itemId, recordedRevision);
    if (!guard.eligible) return guard;
    const row = await store.read(ownerId, itemId);
    if ((row?.data as unknown as ReceiptData | undefined)?.linkedTransactionId) {
      return { eligible: false, reason: "A Transaction Is Linked to This Receipt" };
    }
    return { eligible: true, reason: null };
  },
};
