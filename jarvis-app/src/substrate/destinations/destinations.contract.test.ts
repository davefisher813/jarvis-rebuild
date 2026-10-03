import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ADAPTERS, adapterFor, fetchReadiness, readinessFrom } from "./registry";
import { DESTINATION_OF, ITEM_CHANGED, ITEM_REMOVED, type PrepareContext } from "./types";
import { captureClientId, wallClock } from "./schedule";
import { ledgerAmount, minorUnitScale } from "./money";
import { LedgerService } from "../../money/ledger/LedgerService";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT } from "../../money/ledger/types";
import { emailSourceFor } from "../../money/ledger/emailBill";
import { TasksService } from "../../tasks/TasksService";
import { ScheduleService } from "../../schedule/ScheduleService";
import { WaitingService } from "../waiting/WaitingService";
import { madeBy } from "../../shared/provenance";
import type { BillPayload, EventPayload, ReceiptPayload, TaskPayload, WaitingPayload } from "../contracts";

// THE CONTRACT TESTS (IMPLEMENTATION-SPEC.md section 14: "one shared adapter
// contract document and contract tests"). For every destination: what the
// adapter prepares is byte-for-byte what the module's own writer stores, a
// commit lands in the module's own list, a second commit is one record, and
// the refusals are the module's refusals.

const NOW = "2026-10-03T12:00:00.000Z";
const U = "user-a";
const ctx: PrepareContext = { now: () => NOW, today: "2026-10-03", zone: "America/New_York", threadId: "t-con-ed", account: "dave@example.test" };
const manualCtx: PrepareContext = { now: () => NOW, today: "2026-10-03", zone: "America/New_York" };
const EVIDENCE = [{ evidence_id: "ev-1", source_hash: "sh-1", text_start: 0, text_end: 12, entered_by_user: false }];
const rig = () => new Store(new InMemoryAdapter());
const data = async (store: Store, id: string) => (await store.read(U, id))!.data;

const BILL: BillPayload = { kind: "bill", issuer: " Con Edison ", amount: { minor_units: 14230, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false };
const RECEIPT: ReceiptPayload = { kind: "receipt", merchant: "Delta", amount: { minor_units: 28410, currency: "USD" }, purchase_date: "2026-10-02", transaction_type: "purchase" };
const TASK: TaskPayload = { kind: "task", title: "Review Peña transcript", due_date: "2026-10-09", notes: "" };
const EVENT: EventPayload = { kind: "event", title: "Rodriguez callback", time: { all_day: false, start_at: "2026-10-04T14:00:00Z", end_at: "2026-10-04T14:15:00Z", timezone: "America/New_York", selected_offset: "-04:00" }, location: null, external_uid: null };
const WAITING: WaitingPayload = { kind: "waiting", title: "Peña transcript", waiting_for: "the transcript", counterparty_display: "Coach Miller", contact_id: null, follow_up_on: "2026-10-10" };

describe("the registry routes every kind to its one module", () => {
  it("bills and receipts go to Money, never to Tasks or Schedule", () => {
    expect(DESTINATION_OF.bill).toBe(ENTITY_MONEY_BILL);
    expect(DESTINATION_OF.receipt).toBe(ENTITY_MONEY_RECEIPT);
    expect(adapterFor("bill").destinationKind).toBe("money_bill");
    expect(adapterFor("receipt").destinationKind).toBe("money_receipt");
    expect(adapterFor("task").destinationKind).toBe("task");
    expect(adapterFor("event").destinationKind).toBe("event");
    expect(adapterFor("waiting").destinationKind).toBe("waiting");
    for (const k of Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[]) expect(ADAPTERS[k].kind).toBe(k);
  });
});

describe("Money bill: the adapter stores what LedgerService.addBill stores", () => {
  it("prepares the exact ledger record, history line and fingerprint included", async () => {
    const p = await ADAPTERS.bill.prepare(BILL, EVIDENCE, ctx);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const theirs = rig();
    const r = await new LedgerService(theirs, U, () => {}, ctx.now).addBill(
      { vendor: "Con Edison", amount: "142.30", currency: "USD", dueDate: "2026-10-15", notes: null }, emailSourceFor("t-con-ed"), "email");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(p.data).toEqual(await data(theirs, r.id));
    expect(p.exactEffect).toBe("Saved $142.30 Bill to Money");
    expect(p.displaySummary).toBe("Con Edison · $142.30 · Due Oct 15");
    expect(p.normalizedPayload.issuer).toBe("Con Edison");
    expect(p.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("commits into Money's own list, once, and a second tap is the same bill", async () => {
    const store = rig();
    const p = await ADAPTERS.bill.prepare(BILL, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c1 = await ADAPTERS.bill.commit(store, U, p, ctx);
    const c2 = await ADAPTERS.bill.commit(store, U, p, ctx);
    const bills = await new LedgerService(store, U).listBills();
    expect(bills.map((b) => b.id)).toEqual([c1.itemId]);
    expect(bills[0]!.data).toEqual(p.data);
    expect(c2.duplicateOf).toBe(c1.itemId);
    expect(c2.exactEffect).toBe("Already in Money · Con Edison $142.30");
    expect(c1.revision).toBeGreaterThan(0);
  });

  it("a manual capture is a manual bill, by the person", async () => {
    const p = await ADAPTERS.bill.prepare(BILL, EVIDENCE, manualCtx);
    if (!p.ok) throw new Error("prepare");
    expect(p.data.source).toBe("manual");
    expect((p.data.history as { by: string }[])[0]!.by).toBe("user");
  });

  it("refuses what the ledger refuses, naming the field", async () => {
    expect(await ADAPTERS.bill.prepare({ ...BILL, due_date: null }, EVIDENCE, ctx)).toMatchObject({ ok: false, code: "MISSING_DETAILS", missing: ["due_date"] });
    const noDue = await ADAPTERS.bill.prepare({ ...BILL, due_date: null, no_due_date_confirmed: true }, EVIDENCE, ctx);
    expect(noDue.ok && noDue.displaySummary).toBe("Con Edison · $142.30 · No Due Date");
    expect(await ADAPTERS.bill.prepare({ ...BILL, issuer: "  " }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["issuer"] });
    expect(await ADAPTERS.bill.prepare({ ...BILL, amount: { minor_units: 0, currency: "USD" } }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["amount"] });
    expect(await ADAPTERS.bill.prepare({ ...BILL, amount: { minor_units: 1200, currency: "JPY" } }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["currency"] });
    expect(await ADAPTERS.bill.prepare({ ...BILL, amount: { minor_units: 12.5, currency: "USD" } }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["amount"] });
    expect(await ADAPTERS.bill.prepare({ ...BILL, due_date: "2026-02-31" }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["due_date"] });
  });

  it("minor units respect the currency's scale and never pass through a float", () => {
    expect(minorUnitScale("USD")).toBe(2);
    expect(minorUnitScale("JPY")).toBe(0);
    expect(minorUnitScale("XXX_NOT")).toBeNull();
    expect(ledgerAmount({ minor_units: 14230, currency: "USD" })).toEqual({ ok: true, amount: "142.30" });
    expect(ledgerAmount({ minor_units: 5, currency: "USD" })).toEqual({ ok: true, amount: "0.05" });
  });

  it("Undo is honest: eligible while unchanged, refused after a change, a delete, or a linked payment", async () => {
    const store = rig();
    const p = await ADAPTERS.bill.prepare(BILL, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c = await ADAPTERS.bill.commit(store, U, p, ctx);
    expect(await ADAPTERS.bill.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: true, reason: null });
    await store.update(U, c.itemId, { notes: "edited" });
    expect(await ADAPTERS.bill.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: false, reason: ITEM_CHANGED });
    const rev = (await store.read(U, c.itemId))!.serverTime;
    await store.create(U, "money_tx", { paysBillId: c.itemId, amountCents: 14230 });
    expect(await ADAPTERS.bill.canUndo(store, U, c.itemId, rev)).toEqual({ eligible: false, reason: "A Payment Is Linked to This Bill" });
    await store.delete(U, c.itemId);
    expect(await ADAPTERS.bill.canUndo(store, U, c.itemId, rev)).toEqual({ eligible: false, reason: ITEM_REMOVED });
  });
});

describe("Money receipt: the adapter stores what LedgerService.addReceipt stores", () => {
  it("prepares the exact ledger record", async () => {
    const p = await ADAPTERS.receipt.prepare(RECEIPT, EVIDENCE, ctx);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const theirs = rig();
    const r = await new LedgerService(theirs, U, () => {}, ctx.now).addReceipt(
      { vendor: "Delta", amount: "284.10", currency: "USD", transactionDate: "2026-10-02" }, emailSourceFor("t-con-ed"), ctx.today);
    if (!r.ok) throw new Error("addReceipt");
    expect(p.data).toEqual(await data(theirs, r.id));
    expect(p.exactEffect).toBe("Saved $284.10 Receipt to Money");
  });

  it("commits into Money's receipts once", async () => {
    const store = rig();
    const p = await ADAPTERS.receipt.prepare(RECEIPT, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c1 = await ADAPTERS.receipt.commit(store, U, p, ctx);
    const c2 = await ADAPTERS.receipt.commit(store, U, p, ctx);
    expect((await new LedgerService(store, U).listReceipts()).map((r) => r.id)).toEqual([c1.itemId]);
    expect(c2.duplicateOf).toBe(c1.itemId);
  });

  it("a refund waits in Email: Money has no refund yet", async () => {
    expect(await ADAPTERS.receipt.prepare({ ...RECEIPT, transaction_type: "refund" }, EVIDENCE, ctx))
      .toMatchObject({ ok: false, code: "UNSUPPORTED", missing: ["transaction_type"] });
  });

  it("a receipt needs a real purchase date", async () => {
    expect(await ADAPTERS.receipt.prepare({ ...RECEIPT, purchase_date: "yesterday" }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["purchase_date"] });
  });
});

describe("Tasks: the adapter stores what TasksService.createTask stores", () => {
  it("prepares the exact task, with its email provenance", async () => {
    const p = await ADAPTERS.task.prepare(TASK, EVIDENCE, ctx);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const theirs = rig();
    const id = await new TasksService(theirs, U).createTask("Review Peña transcript", {
      due: "2026-10-09", fromThread: "t-con-ed", source: madeBy("email", "t-con-ed", () => Date.parse(NOW)),
    });
    expect(p.data).toEqual(await data(theirs, id!));
    expect(p.exactEffect).toBe("Added to Tasks · Review Peña transcript");
  });

  it("commits into the Tasks list", async () => {
    const store = rig();
    const p = await ADAPTERS.task.prepare(TASK, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c = await ADAPTERS.task.commit(store, U, p, ctx);
    const tasks = await new TasksService(store, U).listTasks();
    expect(tasks.map((t) => t.id)).toEqual([c.itemId]);
    expect(tasks[0]!.data.fromThread).toBe("t-con-ed");
  });

  it("no deadline is an explicit null, never a guessed date", async () => {
    const p = await ADAPTERS.task.prepare({ ...TASK, due_date: null }, EVIDENCE, ctx);
    expect(p.ok && p.data.due).toBeUndefined();
    expect(p.ok && p.displaySummary).toBe("Review Peña transcript · No Deadline");
    expect(await ADAPTERS.task.prepare({ ...TASK, title: " " }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["title"] });
  });

  it("Undo is refused once the task is on the schedule", async () => {
    const store = rig();
    const p = await ADAPTERS.task.prepare(TASK, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c = await ADAPTERS.task.commit(store, U, p, ctx);
    expect(await ADAPTERS.task.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: true, reason: null });
    await new ScheduleService(store, U).createEvent("Block", { date: "2026-10-09", start: "09:00", taskIds: [c.itemId] });
    expect(await ADAPTERS.task.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: false, reason: "This Task Is on Your Schedule" });
  });
});

describe("Schedule: the adapter stores what ScheduleService.createEvent stores", () => {
  it("writes a timed instant as the reader's wall clock", async () => {
    expect(wallClock("2026-10-04T14:00:00Z", "America/New_York")).toEqual({ date: "2026-10-04", time: "10:00" });
    expect(wallClock("2026-10-04T14:00:00Z", "Not/AZone")).toBeNull();
    const p = await ADAPTERS.event.prepare(EVENT, EVIDENCE, ctx);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const theirs = rig();
    const id = await new ScheduleService(theirs, U).createEvent("Rodriguez callback", {
      date: "2026-10-04", start: "10:00", end: "10:15",
      source: madeBy("email", "t-con-ed", () => Date.parse(NOW)),
      clientId: captureClientId(ctx, EVENT, "2026-10-04", "10:00"),
    });
    expect(p.data).toEqual(await data(theirs, id!));
    expect(p.displaySummary).toBe("Rodriguez callback · 2026-10-04 · 10:00 to 10:15");
    expect(p.exactEffect).toBe("Added to Schedule · Rodriguez callback");
  });

  it("commits once: the same appointment on a second tap is the same row", async () => {
    const store = rig();
    const p = await ADAPTERS.event.prepare(EVENT, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c1 = await ADAPTERS.event.commit(store, U, p, ctx);
    const c2 = await ADAPTERS.event.commit(store, U, p, ctx);
    expect(c2.itemId).toBe(c1.itemId);
    expect(c2.duplicateOf).toBe(c1.itemId);
    expect((await new ScheduleService(store, U).listEvents()).length).toBe(1);
  });

  it("an all-day event is one day at midnight, the importer's own shape", async () => {
    const p = await ADAPTERS.event.prepare({ ...EVENT, time: { all_day: true, start_date: "2026-10-10", end_date_exclusive: "2026-10-11" } }, EVIDENCE, ctx);
    expect(p.ok && p.data.date).toBe("2026-10-10");
    expect(p.ok && p.data.start).toBe("00:00");
    expect(p.ok && p.data.end).toBeUndefined();
  });

  it("what the Schedule cannot draw is not drawn: multi-day, across midnight, end before start", async () => {
    expect(await ADAPTERS.event.prepare({ ...EVENT, time: { all_day: true, start_date: "2026-10-10", end_date_exclusive: "2026-10-13" } }, EVIDENCE, ctx))
      .toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(await ADAPTERS.event.prepare({ ...EVENT, time: { all_day: false, start_at: "2026-10-05T03:30:00Z", end_at: "2026-10-05T04:30:00Z", timezone: "America/New_York", selected_offset: "-04:00" } }, EVIDENCE, ctx))
      .toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(await ADAPTERS.event.prepare({ ...EVENT, time: { all_day: false, start_at: "2026-10-04T14:15:00Z", end_at: "2026-10-04T14:00:00Z", timezone: "America/New_York", selected_offset: "-04:00" } }, EVIDENCE, ctx))
      .toMatchObject({ ok: false, code: "MISSING_DETAILS", missing: ["time"] });
    expect(await ADAPTERS.event.prepare({ ...EVENT, time: { ...EVENT.time, timezone: "Mars/Olympus" } as EventPayload["time"] }, EVIDENCE, ctx))
      .toMatchObject({ ok: false, missing: ["timezone"] });
  });

  it("Undo is refused once a task hangs off the event", async () => {
    const store = rig();
    const p = await ADAPTERS.event.prepare(EVENT, EVIDENCE, ctx);
    if (!p.ok) throw new Error("prepare");
    const c = await ADAPTERS.event.commit(store, U, p, ctx);
    expect(await ADAPTERS.event.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: true, reason: null });
    await new TasksService(store, U).createTask("Print the roster", { eventId: c.itemId });
    expect(await ADAPTERS.event.canUndo(store, U, c.itemId, c.revision)).toEqual({ eligible: false, reason: "Tasks Are Attached to This Event" });
  });
});

describe("Waiting: the adapter stores what WaitingService stores", () => {
  it("prepares and commits an open request with its evidence", async () => {
    const store = rig();
    const p = await ADAPTERS.waiting.prepare(WAITING, EVIDENCE, ctx);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.exactEffect).toBe("Tracked · Peña transcript");
    const c = await ADAPTERS.waiting.commit(store, U, p, ctx);
    const rows = await new WaitingService(store, U).list();
    expect(rows.map((r) => r.id)).toEqual([c.itemId]);
    expect(rows[0]!.data).toMatchObject({ status: "open", startedAt: NOW, followUpOn: "2026-10-10", sourceEvidenceId: "ev-1", threadId: "t-con-ed", account: "dave@example.test" });
    expect(p.data).toEqual(rows[0]!.data);
  });

  it("names what is missing", async () => {
    expect(await ADAPTERS.waiting.prepare({ ...WAITING, counterparty_display: "" }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["counterparty_display"] });
    expect(await ADAPTERS.waiting.prepare({ ...WAITING, follow_up_on: "soon" }, EVIDENCE, ctx)).toMatchObject({ ok: false, missing: ["follow_up_on"] });
  });
});

describe("readiness: unavailable unless proven", () => {
  const ALL = new Set(["money_bill", "money_receipt", "task", "event", "waiting", "exploration_note", "decision_record"]);

  it("an unknown registry means nothing is ready", () => {
    const r = readinessFrom(null);
    expect(r.migration).toBe("unknown");
    for (const k of ["bill", "receipt", "task", "event", "waiting"] as const) expect(r.kinds[k].state).toBe("unavailable");
  });

  it("a full registry opens every door; one missing kind closes only its door, with the module's own line", () => {
    const all = readinessFrom(ALL);
    for (const k of ["bill", "receipt", "task", "event", "waiting"] as const) expect(all.kinds[k]).toEqual({ state: "ready" });
    const noWaiting = new Set(ALL); noWaiting.delete("waiting");
    const r = readinessFrom(noWaiting);
    expect(r.kinds.waiting).toEqual({ state: "unavailable", reason: "Email Isn't Ready · Your Request Is Still Here" });
    expect(r.kinds.bill).toEqual({ state: "ready" });
    const noMoney = new Set(ALL); noMoney.delete("money_bill");
    expect(readinessFrom(noMoney).kinds.bill).toEqual({ state: "unavailable", reason: "Money Isn't Ready · Your Bill Is Still Here" });
  });

  it("asks the database, and reads a missing function as the migration not run", async () => {
    const applied = await fetchReadiness(async () => ({ data: { schema_version: 1, migration: "0044", registered: [...ALL] }, error: null }));
    expect(applied.migration).toBe("applied");
    expect(applied.kinds.bill.state).toBe("ready");
    const missing = await fetchReadiness(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.substrate_readiness" } }));
    expect(missing.migration).toBe("missing");
    expect(missing.kinds.bill.state).toBe("unavailable");
    const down = await fetchReadiness(async () => { throw new Error("network"); });
    expect(down.migration).toBe("unknown");
    const odd = await fetchReadiness(async () => ({ data: { registered: "not a list" }, error: null }));
    expect(odd.migration).toBe("unknown");
  });
});
