// WHAT THE RULES PROPOSE, THE MODULES CAN HOLD (docs/jarvis-unified, slice 06;
// IMPLEMENTATION-SPEC.md 08 E07 to E11; prompt 06 "Verify before completing":
// "captured records are visible in the destination modules"). The chain is
// the one the phone runs: a fixture email read by the deterministic rules, the
// proposal prepared by the destination adapter the card would use, the
// prepared data inserted exactly as capture_approve inserts it (one row under
// the destination kind, the data as prepared, nothing added), and the row read
// back through the module's own service. A bill lands only in Money, never in
// Tasks or Schedule; a flight's receipt and itinerary are a receipt and an
// event, and nothing else.
import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { extractCandidates, type ExtractInput, type Proposal } from "./index";
import { ADAPTERS } from "../destinations/registry";
import type { PrepareContext } from "../destinations/types";
import { LedgerService } from "../../money/ledger/LedgerService";
import { TasksService } from "../../tasks/TasksService";
import { ScheduleService } from "../../schedule/ScheduleService";
import { WaitingService } from "../waiting/WaitingService";

const NOW = "2026-10-03T13:30:00.000Z";
const U = "user-a";
const base: Omit<ExtractInput, "from_address" | "from_name" | "subject" | "body"> = {
  account_id: "acct-dave", message_id: "msg-1", account: "dave@example.test", internal_date: "2026-10-03T13:24:00Z", zone: "America/New_York",
};
const mail = (from_address: string, from_name: string, subject: string, body: string, message_id = "msg-1"): ExtractInput => ({ ...base, message_id, from_address, from_name, subject, body });
const ctx = (threadId: string): PrepareContext => ({ now: () => NOW, today: "2026-10-03", zone: "America/New_York", threadId, account: "dave@example.test" });
const EVIDENCE = [{ evidence_id: "ev-1", source_hash: "sh-1", text_start: 0, text_end: 12, entered_by_user: false }];

/** The phone's path for one message: rules, adapter, the server's one insert per card. */
async function capture(store: Store, input: ExtractInput, threadId = "t-" + input.message_id): Promise<{ proposals: Proposal[]; ids: Record<string, string> }> {
  const proposals = extractCandidates(input);
  const ids: Record<string, string> = {};
  for (const p of proposals) {
    expect(p.missing, `${p.kind} from "${input.subject}" should be complete`).toEqual([]);
    const prepared = await ADAPTERS[p.kind].prepare(p.payload as never, EVIDENCE, ctx(threadId));
    expect(prepared.ok, `${p.kind} from "${input.subject}" should prepare`).toBe(true);
    if (!prepared.ok) continue;
    // capture_approve: insert into item (owner_id, entity_type, data) values (owner, dest_kind, cap_data)
    ids[p.kind] = await store.create(U, prepared.destinationKind, prepared.data);
  }
  return { proposals, ids };
}

const lists = (store: Store) => ({
  bills: () => new LedgerService(store, U).listBills(),
  receipts: () => new LedgerService(store, U).listReceipts(),
  tasks: () => new TasksService(store, U).listTasks(),
  events: () => new ScheduleService(store, U).listEvents(),
  waiting: () => new WaitingService(store, U).list(),
});

describe("the four fixture cards land in their modules, and nowhere else", () => {
  it("Con Edison's bill is a Money bill with the email's amount and due date, and no task or event is made from it", async () => {
    const store = new Store(new InMemoryAdapter());
    const { ids } = await capture(store, mail("billing@conedison.test", "Con Edison", "Your October bill is ready", "Your October statement is ready.\n\nAmount due: USD 142.30\nDue date: October 15, 2026\n\nThank you for being a customer."));
    expect(Object.keys(ids)).toEqual(["bill"]);
    const l = lists(store);
    const bills = await l.bills();
    expect(bills.map((b) => b.id)).toEqual([ids.bill]);
    expect(bills[0]!.data).toMatchObject({ vendor: "Con Edison", amountCents: 14230, currency: "USD", dueDate: "2026-10-15" });
    expect(await l.tasks()).toEqual([]);
    expect(await l.events()).toEqual([]);
    expect(await l.receipts()).toEqual([]);
    expect(await l.waiting()).toEqual([]);
  });

  it("Delta's payment receipt is a Money receipt, paid Oct 2, and never a bill", async () => {
    const store = new Store(new InMemoryAdapter());
    const { ids } = await capture(store, mail("receipts@delta.test", "Delta Air Lines", "Your payment receipt", "Payment receipt\n\nTotal paid: USD 284.10\nPurchase date: October 2, 2026\n\nThis is your payment receipt, not your travel itinerary."));
    expect(Object.keys(ids)).toEqual(["receipt"]);
    const l = lists(store);
    const receipts = await l.receipts();
    expect(receipts.map((r) => r.id)).toEqual([ids.receipt]);
    expect(receipts[0]!.data).toMatchObject({ vendor: "Delta Air Lines", amountCents: 28410, currency: "USD", transactionDate: "2026-10-02" });
    expect(await l.bills()).toEqual([]);
    expect(await l.events()).toEqual([]);
  });

  it("Coach Miller's transcript review is a task due Oct 9 in the Tasks list, carrying its thread", async () => {
    const store = new Store(new InMemoryAdapter());
    const { ids } = await capture(store, mail("coach@example.test", "Coach Miller", "Transcript", "Can you review the Peña transcript by October 9?"), "t-transcript");
    expect(Object.keys(ids)).toEqual(["task"]);
    const tasks = await lists(store).tasks();
    expect(tasks.map((t) => t.id)).toEqual([ids.task]);
    expect(tasks[0]!.data).toMatchObject({ text: "Review the Peña Transcript", due: "2026-10-09", done: false, fromThread: "t-transcript" });
  });

  it("Mrs. Rodriguez's call is one Schedule event on Oct 4 at 10:00 for fifteen minutes, in the reader's wall clock", async () => {
    const store = new Store(new InMemoryAdapter());
    const { ids } = await capture(store, mail("rodriguez@example.test", "Mrs. Rodriguez", "Quick call about the deposit?", "Hi Dave,\n\nCould we have a quick call about the deposit on October 4 at 10 AM Eastern? Fifteen minutes should be enough.\n\nThank you!"));
    expect(Object.keys(ids)).toEqual(["event"]);
    const events = await lists(store).events();
    expect(events.map((e) => e.id)).toEqual([ids.event]);
    expect(events[0]!.data).toMatchObject({ title: "Quick Call About the Deposit", date: "2026-10-04", start: "10:00", end: "10:15" });
    expect(await lists(store).tasks()).toEqual([]);
  });

  it("Coach Miller's promise is an open Waiting row from the sender, and nothing in Tasks", async () => {
    const store = new Store(new InMemoryAdapter());
    const { ids } = await capture(store, mail("coach@example.test", "Coach Miller", "Re: Peña transcript", "Dave,\n\nI'll get Peña's transcript over to you once the school sends it to me.\n\nCoach Miller"), "t-pena");
    expect(Object.keys(ids)).toEqual(["waiting"]);
    const rows = await lists(store).waiting();
    expect(rows.map((r) => r.id)).toEqual([ids.waiting]);
    expect(rows[0]!.data).toMatchObject({ title: "Peña's Transcript", status: "open", startedAt: NOW, threadId: "t-pena", account: "dave@example.test" });
    expect(await lists(store).tasks()).toEqual([]);
  });
});

describe("one inbox, every module", () => {
  it("five messages make five records, one per module list, each readable where the person would look for it", async () => {
    const store = new Store(new InMemoryAdapter());
    const inbox: ExtractInput[] = [
      mail("billing@conedison.test", "Con Edison", "Your October bill is ready", "Amount due: USD 142.30\nDue date: October 15, 2026", "m1"),
      mail("receipts@delta.test", "Delta Air Lines", "Your payment receipt", "Total paid: USD 284.10\nPurchase date: October 2, 2026", "m2"),
      mail("coach@example.test", "Coach Miller", "Transcript", "Can you review the Peña transcript by October 9?", "m3"),
      mail("rodriguez@example.test", "Mrs. Rodriguez", "Quick call about the deposit?", "Could we have a quick call about the deposit on October 4 at 10 AM Eastern? Fifteen minutes should be enough.", "m4"),
      mail("coach@example.test", "Coach Miller", "Re: Peña transcript", "I'll get Peña's transcript over to you once the school sends it to me.", "m5"),
      mail("wei@example.test", "Wei Chang", "September expense summary", "The updated September expense summary is attached for your review.", "m6"),
    ];
    const made: string[] = [];
    for (const m of inbox) made.push(...Object.keys((await capture(store, m)).ids));
    expect(made.sort()).toEqual(["bill", "event", "receipt", "task", "waiting"]);
    const l = lists(store);
    expect((await l.bills()).length).toBe(1);
    expect((await l.receipts()).length).toBe(1);
    expect((await l.tasks()).length).toBe(1);
    expect((await l.events()).length).toBe(1);
    expect((await l.waiting()).length).toBe(1);
    // Six rows in the account in all: five records and nothing for Wei.
    expect((await store.listForUser(U)).length).toBe(5);
  });

  it("a flight's receipt and itinerary are a Money receipt and a Schedule event; neither makes a task or a bill", async () => {
    const store = new Store(new InMemoryAdapter());
    await capture(store, mail("itinerary@airline.test", "Airline", "Your itinerary", "Flight DEN to SEA departs October 12 at 7:15 AM MT. Confirmation ABC123.", "m7"));
    await capture(store, mail("receipts@airline.test", "Airline", "Payment receipt", "Total paid: USD 284.10 on October 2, 2026 for your flight.", "m8"));
    const l = lists(store);
    expect((await l.events()).map((e) => e.data.title)).toEqual(["Flight DEN to SEA"]);
    expect((await l.receipts()).map((r) => r.data.amountCents)).toEqual([28410]);
    expect(await l.bills()).toEqual([]);
    expect(await l.tasks()).toEqual([]);
  });
});
