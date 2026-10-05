// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTasks, useProfile } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";
import { LedgerService } from "./ledger/LedgerService";
import { suggestionKey, dismissSuggestion } from "./suggestionMemory";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { monthDay } from "./bills";
import { subscribeToast, resetToasts } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import type { TasksService } from "../tasks/TasksService";

// THE MONEY SCREEN'S BILLS, THE LEDGER WAY (lane B). Bills are ledger records:
// vendor, amount, optional due date, a status computed from dates and evidence,
// a history. These drive the real MoneyFlow through the real provider, and the
// legacy bill tasks beside them prove the old rows still behave.

const T = todayISO();
const day = (n: number) => addDays(T, n);

let ledgerRef: LedgerService | null = null;
let tasksRef: TasksService | null = null;

/** Runs `seed` once with the services, then shows its children. */
function Seed({ seed, children }: { seed: (l: LedgerService, t: TasksService) => Promise<void>; children: ReactNode }) {
  const ledger = useLedger();
  const tasks = useTasks();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ledgerRef = ledger;
    tasksRef = tasks;
    void seed(ledger, tasks).then(() => setReady(true));
  }, [ledger, tasks, seed]);
  return ready ? <>{children}</> : null;
}

const mount = (user: string, seed: (l: LedgerService, t: TasksService) => Promise<void>, props: Parameters<typeof MoneyFlow>[0] = {}) =>
  render(<NotesProvider userId={user}><Seed seed={seed}><MoneyFlow {...props} /></Seed></NotesProvider>);

async function legacyBill(t: TasksService, text: string, o: { due?: string; bill: { amount: number; autopay?: boolean } }) {
  return t.recreateFrom({ text, category: "", done: false, ...o });
}
const add = async (l: LedgerService, i: Parameters<LedgerService["addBill"]>[0]) => {
  const r = await l.addBill(i);
  if (!r.ok) throw new Error(r.errors.join());
  return r.id;
};

afterEach(() => { vi.restoreAllMocks(); resetToasts(); });

describe("the Bills list: ledger and legacy rows together", () => {
  it("lists both by due date with blank due dates last, ledger rows showing vendor, amount and a status chip", async () => {
    mount("mb-list", async (l, t) => {
      await add(l, { vendor: "Water", amount: 40 });                       // no due date
      await add(l, { vendor: "ConEdison", amount: 84.12, dueDate: day(3) });
      await add(l, { vendor: "Internet", amount: 60, dueDate: day(-3) });
      await legacyBill(t, "Rent", { due: day(1), bill: { amount: 1850 } });
    });
    await screen.findByText("ConEdison");
    const names = [...document.querySelectorAll(".task-row .task-name")].map((n) => n.textContent).filter((n) => n !== "Set Up Payday");
    expect(names).toEqual(["Internet", "Rent", "ConEdison", "Water"]);

    const row = (name: string) => screen.getByText(name).closest(".task-row") as HTMLElement;
    // overdue: the late chip, which wears the Colour Key's red
    expect(within(row("Internet")).getByText("3 Days Late")).toHaveClass("uchip", "u-late");
    expect(within(row("Internet")).getByText("$60")).toBeInTheDocument();
    // due soon: plain words, the warn chip
    expect(within(row("ConEdison")).getByText("Due in 3 Days")).toHaveClass("uchip", "u-today");
    expect(within(row("ConEdison")).getByText("$84.12")).toBeInTheDocument();
    // no due date: no chip, no date, never late
    expect(within(row("Water")).queryByText(/Late|Due/)).toBeNull();
  });

  it("a bill with no due date is never called overdue, whatever the date", async () => {
    mount("mb-nodate", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    expect(screen.queryByText(/Late/)).toBeNull();
    expect(ledgerRef).not.toBeNull();
    expect((await ledgerRef!.overdue("2099-01-01"))).toEqual([]);
  });

  it("a paid ledger bill reads Paid with its day, in the paid green", async () => {
    mount("mb-paid", async (l) => {
      const id = await add(l, { vendor: "Water", amount: 40, dueDate: day(-2) });
      await l.markBillPaidByUser(id, day(-1));
    });
    expect(await screen.findByText(`Paid ${monthDay(day(-1))}`)).toHaveClass("fact", "good");
  });

  it("a ledger bill on autopay says Set to Autopay and nothing about paid, even long past its date", async () => {
    mount("mb-autopay", async (l) => { await add(l, { vendor: "Rent", amount: 1850, dueDate: day(-10), autopay: true }); });
    expect(await screen.findByText("Set to Autopay")).toBeInTheDocument();
    expect(screen.queryByText(/Paid/)).toBeNull();
    // no check to tick on autopay: the glyph sits there, as on a legacy row
    expect(screen.queryByLabelText("Mark paid")).toBeNull();
  });

  it("the page is not an empty state when the only bill is a ledger bill", async () => {
    mount("mb-only", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    expect(screen.queryByText("No Accounts Yet")).toBeNull();
  });
});

describe("Add a bill: a ledger bill in three taps", () => {
  it("vendor, amount, Save: no due date is invented, currency is dollars, nothing is a task", async () => {
    mount("mb-add", async () => undefined);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "ConEdison" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "84.12" } });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("$84.12");

    const bills = await ledgerRef!.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data).toMatchObject({ vendor: "ConEdison", amountCents: 8412, currency: "USD", source: "manual" });
    expect(bills[0]!.data.dueDate).toBeUndefined();
    expect(bills[0]!.data.recurrence).toBeUndefined(); // a schedule is the person's choice
    expect(bills[0]!.data.history[0]).toMatchObject({ by: "user", action: "created" });
    expect(await tasksRef!.listTasks()).toEqual([]);
    expect(screen.queryByText(/Due/)).toBeNull();
  });

  it("carries a due date, notes, autopay, a pay link and a repeat when the person chooses them", async () => {
    mount("mb-add2", async () => undefined);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Next due"), { target: { value: day(10) } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "annual fee" } });
    fireEvent.click(screen.getByLabelText("Autopay"));
    fireEvent.change(screen.getByLabelText("Pay link"), { target: { value: "gym.example.com" } });
    fireEvent.click(screen.getByLabelText("Repeats"));
    fireEvent.click(await screen.findByText("Yearly"));
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("Gym");
    const [b] = await ledgerRef!.listBills();
    expect(b!.data).toMatchObject({ dueDate: day(10), notes: "annual fee", autopay: true, payUrl: "https://gym.example.com", recurrence: "yearly" });
  });

  it("a new bill starts as Once, not Monthly", async () => {
    mount("mb-once", async () => undefined);
    fireEvent.click(await screen.findByText("Add a Bill"));
    expect(screen.getByLabelText("Repeats")).toHaveTextContent("Once");
  });

  it("a currency other than dollars is kept, and a made-up code is turned back before anything is written", async () => {
    mount("mb-cur", async () => undefined);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Hotel" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Use a three letter currency code like USD")).toBeInTheDocument();
    expect(await ledgerRef!.listBills()).toEqual([]);
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("EUR 200.00");
    expect((await ledgerRef!.listBills())[0]!.data.currency).toBe("EUR");
  });

  it("the service refuses a bad currency too (the sheet is not the only wall)", async () => {
    mount("mb-cur2", async () => undefined);
    await screen.findByText("Add a Bill");
    expect(await ledgerRef!.addBill({ vendor: "X", amount: 5, currency: "ZZZ" })).toEqual({ ok: false, errors: ["currency"] });
  });

  it("an exact repeat is not added twice, and says so", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    mount("mb-dup", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    fireEvent.click(screen.getByText("Add Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Water" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(seen).toContain("Already On Your List"));
    expect(await ledgerRef!.listBills()).toHaveLength(1);
    stop();
  });
});

describe("Mark paid: the person's own word, confirmed", () => {
  it("opens a small confirm with today's date, editable; Save writes the user's confirmation on that day", async () => {
    mount("mb-pay", async (l) => { await add(l, { vendor: "Water", amount: 40, dueDate: day(-1) }); });
    await screen.findByText("Water");
    fireEvent.click(screen.getByLabelText("Mark paid"));
    expect(await screen.findByText("Mark Paid")).toBeInTheDocument();
    const date = screen.getByLabelText("Paid on") as HTMLInputElement;
    expect(date.value).toBe(T);
    // nothing is paid until the confirm
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
    fireEvent.change(date, { target: { value: day(-1) } });
    fireEvent.click(screen.getByText("I Paid This"));
    await screen.findByText(`Paid ${monthDay(day(-1))}`);
    const [b] = await ledgerRef!.listBills();
    expect(b!.data).toMatchObject({ paidAt: day(-1), paidEvidence: { type: "user_confirmed" } });
  });

  it("Cancel leaves the bill unpaid", async () => {
    mount("mb-pay-cancel", async (l) => { await add(l, { vendor: "Water", amount: 40, dueDate: day(2) }); });
    await screen.findByText("Water");
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.click(await screen.findByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Mark Paid")).toBeNull());
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
  });

  it("a cleared date cannot be saved: Paid needs a day", async () => {
    mount("mb-pay-nodate", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.change(await screen.findByLabelText("Paid on"), { target: { value: "" } });
    fireEvent.click(screen.getByText("I Paid This"));
    expect(await screen.findByText("Pick the day you paid it")).toBeInTheDocument();
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
  });

  it("a write that fails says so and the bill stays unpaid", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    mount("mb-pay-fail", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    vi.spyOn(LedgerService.prototype, "markBillPaidByUser").mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.click(await screen.findByText("I Paid This"));
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("I Paid This")).toBeInTheDocument(); // Save is a button again
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
    stop();
  });

  it("autopay never makes a bill paid on its own, and the sheet says so", async () => {
    mount("mb-pay-auto", async (l) => { await add(l, { vendor: "Rent", amount: 1850, dueDate: day(-3), autopay: true }); });
    fireEvent.click(await screen.findByText("Rent"));
    // the bill's page: late, set to autopay, not paid
    expect(await screen.findByText("Delete Bill")).toBeInTheDocument();
    expect(screen.getAllByText("3 Days Late").length).toBeGreaterThan(0);
    expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined();
    fireEvent.click(screen.getByText("Mark Paid"));
    expect(await screen.findByText("Autopay Alone Never Marks a Bill Paid")).toBeInTheDocument();
  });
});

describe("the bill's page", () => {
  it("shows status, due date, the evidence line, and every change in the history", async () => {
    mount("mb-detail", async (l) => {
      const id = await add(l, { vendor: "ConEdison", amount: 84.12, dueDate: day(-2) });
      await l.markBillPaidByUser(id, day(-1));
      await l.correctBill(id, { notes: "july bill" });
    });
    fireEvent.click(await screen.findByText("ConEdison"));
    await screen.findByText("Delete Bill");
    expect(screen.getByText(`You Confirmed It ${monthDay(day(-1))}`)).toBeInTheDocument();
    expect(screen.getByText(monthDay(day(-2)))).toBeInTheDocument();
    // history: created, marked paid, corrected, oldest first, with from and to
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Marked Paid")).toBeInTheDocument();
    expect(screen.getByText("Corrected")).toBeInTheDocument();
    // One white fact per change (2026-10-05, the visual catalog gate): the field, the before and the after.
    expect(screen.getByText("Notes None to july bill")).toBeInTheDocument();
  });

  it("a bill with no due date shows no date and no Due row at all, never a made-up one or a None placeholder", async () => {
    mount("mb-detail-none", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    fireEvent.click(await screen.findByText("Water"));
    await screen.findByText("Delete Bill");
    expect(screen.queryAllByText("Due").filter((n) => n.classList.contains("conn-name"))).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/DueNone/);
  });

  it("editing a bill corrects it and the history shows what changed; a blank due date stays blank", async () => {
    mount("mb-edit", async (l) => { await add(l, { vendor: "ConEdison", amount: 84.12, dueDate: day(5) }); });
    fireEvent.click(await screen.findByText("ConEdison"));
    fireEvent.click(await screen.findByText("Edit"));
    expect(await screen.findByText("Edit Bill")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Next due"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect((await ledgerRef!.listBills())[0]!.data.amountCents).toBe(9000));
    const [b] = await ledgerRef!.listBills();
    expect(b!.data.dueDate).toBeUndefined();
    expect(b!.data.history.map((h) => h.action)).toEqual(["created", "corrected"]);
    expect(b!.data.history[1]!.changes).toMatchObject({ amountCents: { from: 8412, to: 9000 }, dueDate: { from: day(5) } });
    // the page behind the sheet shows it
    const to = await screen.findAllByText("$90");
    expect(to.length).toBeGreaterThan(0);
    expect(screen.getByText(/^Amount \$84\.12 to \$90$/)).toBeInTheDocument();
  });

  it("correcting a paid bill's amount asks to confirm it is still paid, and confirming does", async () => {
    mount("mb-reconfirm", async (l) => {
      const id = await add(l, { vendor: "Water", amount: 40, dueDate: day(-1) });
      await l.markBillPaidByUser(id, day(-1));
      await l.correctBill(id, { amount: 45 });
    });
    expect(await screen.findByText("Confirm It Is Still Paid")).toBeInTheDocument();
    expect(screen.queryByText(/^Paid /)).toBeNull();
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.click(await screen.findByText("I Paid This"));
    await screen.findByText(/^Paid \w{3} \d/);
    expect((await ledgerRef!.listBills())[0]!.data.paidNeedsReconfirm).toBeUndefined();
  });

  it("Remove Paid State takes it back, and Undo puts the person's confirmation back", async () => {
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.actionLabel === "Undo") undo = t.onAction; });
    mount("mb-unpay", async (l) => {
      const id = await add(l, { vendor: "Water", amount: 40, dueDate: day(-1) });
      await l.markBillPaidByUser(id, day(-1));
    });
    fireEvent.click(await screen.findByText("Water"));
    fireEvent.click(await screen.findByText("Remove Paid State"));
    await waitFor(async () => expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBeUndefined());
    await waitFor(() => expect(undo).toBeDefined());
    undo!();
    await waitFor(async () => expect((await ledgerRef!.listBills())[0]!.data.paidAt).toBe(day(-1)));
    stop();
  });

  it("Delete removes it with an Undo that restores the same record", async () => {
    let undo: (() => void) | undefined;
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) { seen.push(t.message); undo = t.onAction; } });
    mount("mb-del", async (l) => { await add(l, { vendor: "Water", amount: 40, dueDate: day(2) }); });
    fireEvent.click(await screen.findByText("Water"));
    const before = (await ledgerRef!.listBills())[0]!;
    fireEvent.click(await screen.findByText("Delete Bill"));
    await waitFor(() => expect(seen).toContain("Bill Deleted"));
    expect(await ledgerRef!.listBills()).toEqual([]);
    await waitFor(() => expect(screen.queryByText("Water")).toBeNull());
    undo!();
    await screen.findByText("Water");
    const after = (await ledgerRef!.listBills())[0]!;
    expect(after.id).toBe(before.id);
    expect(after.data).toEqual(before.data);
    stop();
  });

  it("swiping to delete a ledger row also offers Undo", async () => {
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.actionLabel === "Undo") undo = t.onAction; });
    mount("mb-swipe-del", async (l) => { await add(l, { vendor: "Water", amount: 40 }); });
    await screen.findByText("Water");
    fireEvent.click(screen.getByLabelText("Delete Water"));
    await waitFor(() => expect(screen.queryByText("Water")).toBeNull());
    undo!();
    await screen.findByText("Water");
    stop();
  });

  it("an email-born bill opens the thread it came from, the way every From-an-email line does", async () => {
    const opened: [string, string][] = [];
    mount("mb-email", async (l) => {
      const r = await l.addBill({ vendor: "Verizon", amount: 60, dueDate: day(4) }, { type: "email", fingerprint: "fp1", ref: "thread-9" });
      if (!r.ok) throw new Error("x");
    }, { onOpenEntity: (k, id) => opened.push([k, id]) });
    fireEvent.click(await screen.findByText("Verizon"));
    fireEvent.click(await screen.findByText("From an email"));
    expect(opened).toEqual([["email", "thread-9"]]);
  });

  it("a Today or search hit opens a bill's page by id, once", async () => {
    let id = "";
    function Hit({ children }: { children: (p: { id?: string; nonce: number; consumed: () => void }) => ReactNode }) {
      const [intent, setIntent] = useState<{ id?: string; nonce: number }>({ nonce: 0 });
      return (
        <>
          <button onClick={() => setIntent((i) => ({ id, nonce: i.nonce + 1 }))}>Hit</button>
          {children({ ...intent, consumed: () => setIntent((i) => ({ nonce: i.nonce })) })}
        </>
      );
    }
    render(
      <NotesProvider userId="mb-open">
        <Seed seed={async (l) => { id = await add(l, { vendor: "Water", amount: 40 }); }}>
          <Hit>{(p) => <MoneyFlow openAccountId={p.id} openNonce={p.nonce} onOpenConsumed={p.consumed} />}</Hit>
        </Seed>
      </NotesProvider>,
    );
    await screen.findByText("Water");
    expect(screen.queryByText("Delete Bill")).toBeNull();
    fireEvent.click(screen.getByText("Hit"));
    expect(await screen.findByText("Delete Bill")).toBeInTheDocument();
    // closed by hand, the link is spent: nothing reopens it
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Delete Bill")).toBeNull());
  });
});

describe("a recurring offer, quiet, and nothing is scheduled until Yes", () => {
  const month = (n: number) => {
    const d = new Date(T + "T12:00:00");
    d.setMonth(d.getMonth() - n, 1);
    return todayISO(d);
  };
  const seedThree = (vendor: string) => async (l: LedgerService) => {
    for (const n of [2, 1, 0]) await add(l, { vendor, amount: 84.12, dueDate: month(n) });
  };

  it("three months in a row of the same amount offers Make It Monthly; Yes confirms it on the latest bill", async () => {
    mount("mb-rec", seedThree("Recur Yes Co"));
    expect(await screen.findByText("Recur Yes Co, $84.12")).toBeInTheDocument();
    expect(screen.getByText("3 Months in a Row")).toBeInTheDocument();
    expect(screen.getByText("Make It Monthly?")).toBeInTheDocument();
    // asking changed nothing
    expect((await ledgerRef!.listBills()).every((b) => !b.data.recurrence)).toBe(true);
    fireEvent.click(screen.getByText("Yes"));
    await waitFor(() => expect(screen.queryByText("Make It Monthly?")).toBeNull());
    const monthly = (await ledgerRef!.listBills()).filter((b) => b.data.recurrence === "monthly");
    expect(monthly).toHaveLength(1);
    expect(monthly[0]!.data.dueDate).toBe(month(0));
    expect(monthly[0]!.data.history.at(-1)!.action).toBe("recurrence confirmed");
  });

  it("Not Now hides the offer, schedules nothing, and stays hidden when the page is opened again this session", async () => {
    function Away() {
      const [on, setOn] = useState(true);
      return <><button onClick={() => setOn((v) => !v)}>Toggle Money</button>{on && <MoneyFlow />}</>;
    }
    render(<NotesProvider userId="mb-rec-no"><Seed seed={seedThree("Recur No Co")}><Away /></Seed></NotesProvider>);
    await screen.findByText("Make It Monthly?");
    fireEvent.click(screen.getByText("Not Now"));
    await waitFor(() => expect(screen.queryByText("Make It Monthly?")).toBeNull());
    expect((await ledgerRef!.listBills()).every((b) => !b.data.recurrence)).toBe(true);
    // leave the page and come back: the same session, so it stays quiet
    fireEvent.click(screen.getByText("Toggle Money"));
    await waitFor(() => expect(screen.queryByText("Recur No Co")).toBeNull());
    fireEvent.click(screen.getByText("Toggle Money"));
    await screen.findAllByText("Recur No Co");
    expect(screen.queryByText("Make It Monthly?")).toBeNull();
  });

  it("two months is not a pattern, and a dismissed pattern does not hide a different one", async () => {
    dismissSuggestion(suggestionKey({ vendor: "Elsewhere Co", amountCents: 1 }));
    mount("mb-rec-two", async (l) => { for (const n of [1, 0]) await add(l, { vendor: "Two Co", amount: 10, dueDate: month(n) }); });
    await screen.findAllByText("Two Co");
    expect(screen.queryByText("Make It Monthly?")).toBeNull();
  });
});

describe("what is left before payday counts ledger bills", () => {
  it("subtracts an unpaid ledger bill due before payday from Yours, and a paid one not at all", async () => {
    // payday set up through the real profile, in the same tree
    function Pay() {
      const profile = useProfile();
      const [ok, setOk] = useState(false);
      useEffect(() => { void profile.save({ template: "personal", payday: { amount: 500, next: day(5), freq: "biweekly" } }).then(() => setOk(true)); }, [profile]);
      return ok ? <MoneyFlow /> : null;
    }
    render(<NotesProvider userId="mb-hero"><Seed seed={async (l) => {
      await l.addBill({ vendor: "Unpaid", amount: 100, dueDate: day(2) });
      const id = await add(l, { vendor: "Paid", amount: 300, dueDate: day(1) });
      await l.markBillPaidByUser(id, T);
    }}><Pay /></Seed></NotesProvider>);
    // 500 paycheck less the one unpaid $100 bill; the paid $300 is not out
    await waitFor(() => expect(screen.getByText("$400")).toBeInTheDocument());
    expect(screen.getByText(/Between now and/i)).toBeInTheDocument();
  });
});

// THE WHOLE BILL ROW IS THE DOOR (the tap sweep, 2026-10-04, Dave: no dead
// buttons). An autopay bill's repeat glyph and every bill's amount did nothing
// when tapped; only the title block opened the bill. Each of them opens it now,
// and the row's own controls (the pay ring, Pay) still keep their taps.
describe("every part of a bill row opens the bill", () => {
  it("the amount of a ledger bill opens its page", async () => {
    mount("mb-door-amount", async (l) => { await add(l, { vendor: "Water", amount: 40, dueDate: day(5) }); });
    const row = (await screen.findByText("Water")).closest(".task-row") as HTMLElement;
    fireEvent.click(row.querySelector(".money-amt")!);
    expect(await screen.findByText("Delete Bill")).toBeInTheDocument();
  });

  it("an autopay bill's repeat glyph, which is not a control, opens its page", async () => {
    mount("mb-door-glyph", async (l) => { await add(l, { vendor: "Internet", amount: 89, autopay: true }); });
    const row = (await screen.findByText("Internet")).closest(".task-row") as HTMLElement;
    fireEvent.click(row.querySelector(".task-check-tap")!);
    expect(await screen.findByText("Delete Bill")).toBeInTheDocument();
  });

  it("a legacy bill's amount opens the old Edit Bill sheet", async () => {
    mount("mb-door-legacy", async (_l, t) => { await legacyBill(t, "Rent", { due: day(4), bill: { amount: 1850 } }); });
    const row = (await screen.findByText("Rent")).closest(".task-row") as HTMLElement;
    fireEvent.click(row.querySelector(".money-amt")!);
    expect(await screen.findByText("Edit Bill")).toBeInTheDocument();
  });

  it("the pay ring keeps its own tap: it does not also open the bill", async () => {
    mount("mb-door-ring", async (l) => { await add(l, { vendor: "Gas", amount: 60, dueDate: day(3) }); });
    const row = (await screen.findByText("Gas")).closest(".task-row") as HTMLElement;
    fireEvent.click(row.querySelector("[role=checkbox]")!);
    await waitFor(() => expect(screen.queryByText("Delete Bill")).toBeNull());
  });
});

describe("legacy bill tasks keep working exactly as before", () => {
  it("a legacy bill lists, opens the old Edit Bill sheet, and saves through the task path", async () => {
    mount("mb-legacy-edit", async (_l, t) => { await legacyBill(t, "Rent", { due: day(4), bill: { amount: 1850 } }); });
    fireEvent.click(await screen.findByText("Rent"));
    expect(await screen.findByText("Edit Bill")).toBeInTheDocument();
    // the legacy sheet has no ledger fields
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "1900" } });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("$1,900");
    const [t] = await tasksRef!.listTasks();
    expect(t!.data.bill).toEqual({ amount: 1900 });
    expect(await ledgerRef!.listBills()).toEqual([]);
  });

  it("marking a legacy bill done stamps a dated receipt, with no confirm in the way", async () => {
    mount("mb-legacy-pay", async (_l, t) => { await legacyBill(t, "Electric", { due: day(1), bill: { amount: 120 } }); });
    fireEvent.click(await screen.findByLabelText("Mark paid"));
    await waitFor(() => expect(screen.getByText(/^Paid \w{3} \d/)).toBeInTheDocument());
    expect(screen.queryByText("I Paid This")).toBeNull();
  });

  it("a legacy autopay bill still says Set to Autopay", async () => {
    mount("mb-legacy-auto", async (_l, t) => { await legacyBill(t, "Rent", { due: day(2), bill: { amount: 1850, autopay: true } }); });
    expect(await screen.findByText("Set to Autopay")).toBeInTheDocument();
    expect(screen.queryByText(/Paid/)).toBeNull();
  });

  it("deleting a legacy bill offers Undo and Undo brings the whole bill back", async () => {
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.actionLabel === "Undo") undo = t.onAction; });
    mount("mb-legacy-del", async (_l, t) => { await legacyBill(t, "Rent", { due: day(4), bill: { amount: 1850, autopay: true } }); });
    await screen.findByText("Rent");
    fireEvent.click(screen.getByLabelText("Delete Rent"));
    await waitFor(() => expect(screen.queryByText("Rent")).toBeNull());
    undo!();
    await screen.findByText("Rent");
    const [t] = await tasksRef!.listTasks();
    expect(t!.data.bill).toEqual({ amount: 1850, autopay: true });
    expect(t!.data.due).toBe(day(4));
    stop();
  });

  it("a legacy bill's row never offers the ledger's detail page", async () => {
    mount("mb-legacy-nodetail", async (_l, t) => { await legacyBill(t, "Rent", { due: day(4), bill: { amount: 1850 } }); });
    fireEvent.click(await screen.findByText("Rent"));
    await screen.findByText("Edit Bill");
    expect(screen.queryByText("History")).toBeNull();
  });
});
