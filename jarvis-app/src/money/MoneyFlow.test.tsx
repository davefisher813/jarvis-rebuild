// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProfile } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";
import { todayISO } from "../tasks/grouping";
import { monthDay } from "./bills";
import type { TemplateKey } from "../categories/defaults";
import type { TasksService } from "../tasks/TasksService";
import type { BillInfo } from "../notes/types";

// A BILL TASK FROM BEFORE THE MONEY LEDGER. createTask refuses bills now (a
// bill lives in Money, hard rule 1), but the bills already stored are tasks and
// have to keep working; recreateFrom writes a whole record as it is, which is
// how Undo restores one and how a test makes one.
async function legacyBill(svc: TasksService, text: string, o: { due?: string; category?: string; bill: BillInfo }): Promise<string | null> {
  return svc.recreateFrom({ text, category: o.category ?? "", done: false, ...o });
}

// 2026-09-11: AI is off for every test here except the receipt read, which
// flips it on for itself. The encoder needs a real canvas, so it is stubbed.
const aiState = vi.hoisted(() => ({ available: false, reply: "" }));
vi.mock("../ai/useAI", () => ({
  useAI: () => ({ available: aiState.available, complete: async () => aiState.reply }),
}));
vi.mock("../shared/imageEncode", async (orig) => ({
  ...(await orig<typeof import("../shared/imageEncode")>()),
  encodeImageForVision: async () => ({ data: "x", mediaType: "image/png" }),
}));

describe("MoneyFlow", () => {
  it("empty -> add account -> shows total, dated as self-reported", async () => {
    render(<NotesProvider userId="u1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Total Balance")).toBeInTheDocument());
    expect(screen.getAllByText("$5,000").length).toBeGreaterThanOrEqual(2);
    // The balance is self-reported and the page says so, with a date. The
    // date is its own fact (§AM F3, F5): the dot between them is drawn by
    // CSS, never baked into the words.
    expect(screen.getByText("As You Last Entered It")).toBeInTheDocument();
    expect(screen.getByText(monthDay(todayISO()))).toHaveClass("fact", "date");
  });

  it("adds a bill and marks it paid with a dated receipt; autopay copy never says paid", async () => {
    render(<NotesProvider userId="u2"><MoneyFlow /></NotesProvider>);
    // From empty: the bill path exists without an account. Three taps' worth:
    // the name, the amount, Save. The bill is a LEDGER bill, not a task.
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Electric")).toBeInTheDocument());
    expect(screen.getByText("$120")).toBeInTheDocument();
    // No due date was typed, so none is shown and none is invented.
    expect(screen.queryByText(/Due /)).not.toBeInTheDocument();
    // Mark paid asks first ("I paid this", dated today), then the dated
    // receipt appears.
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.click(await screen.findByText("I Paid This"));
    // UP-CORE-13 (2026-09-05): scoped to the ROW's own line. The page grew a
    // "Paid This Month" head, which is a different claim about the same word
    // and used to make this query ambiguous.
    await waitFor(() => expect(screen.getByText(/^Paid \w{3} \d/)).toBeInTheDocument());

    // autopay bill: only ever "set to autopay" language
    fireEvent.click(screen.getByText("Add Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Rent" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1850" } });
    // Autopay is a switch on the bill sheet (the form sheets, 2026-09-02).
    fireEvent.click(screen.getByLabelText("Autopay"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText(/Set to Autopay/)).toBeInTheDocument();
    expect(screen.queryByText(/Rent.*paid/i)).not.toBeInTheDocument();
  });
});

// One Money (2026-08-10): Dave, "there should only be one money category with
// all of its features". The old Money category opened a dead-end page with
// no financial data; that page is gone, but a task tagged to it (not a bill)
// must not become invisible now that the category no longer has its own
// screen. It surfaces here instead, and opening it hands off through
// onOpenTask exactly like any other deep link.
function SeededTagged({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
  const tasks = useTasks();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = await cats.create("Money", "yellow");
      await tasks.createTask("Budget Review", { category: id! });
      // A done task and a bill-flavored task must NOT show up here: done
      // items are finished, and bills already have their own section.
      const doneId = await tasks.createTask("Old Money Thing", { category: id! });
      await tasks.toggleDone(doneId!);
      await legacyBill(tasks, "Rent", { category: id!, bill: { amount: 100 } });
      // A non-money category's task must never leak into this list either.
      const other = await cats.create("Home", "blue");
      await tasks.createTask("Fix Sink", { category: other! });
      setReady(true);
    })();
  }, [tasks, cats]);
  return ready ? <MoneyFlow onOpenTask={onOpenTask} /> : null;
}

describe("MoneyFlow: tagged Money tasks (2026-08-10)", () => {
  it("surfaces a non-bill task tagged Money, excludes done and other-category tasks", async () => {
    render(<NotesProvider userId="u3"><SeededTagged /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Also Tagged Money")).toBeInTheDocument());
    expect(screen.getByText("Budget Review")).toBeInTheDocument();
    expect(screen.queryByText("Old Money Thing")).not.toBeInTheDocument();
    expect(screen.queryByText("Fix Sink")).not.toBeInTheDocument();
    // Rent is a bill: it shows once, in Bills, never duplicated into this section.
    expect(screen.getAllByText("Rent")).toHaveLength(1);
  });

  it("tapping a tagged task hands off through onOpenTask", async () => {
    const onOpenTask = vi.fn();
    render(<NotesProvider userId="u4"><SeededTagged onOpenTask={onOpenTask} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Budget Review"));
    expect(onOpenTask).toHaveBeenCalledWith(expect.any(String));
  });

  it("a Money-tagged task alone (no accounts, no bills) is not swallowed by the empty state", async () => {
    render(<NotesProvider userId="u5"><SeededTagged /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Budget Review")).toBeInTheDocument());
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });
});

// S5-Q33 (2026-09-04): "the budget half is off for Student and Business."
// The arithmetic (budget.ts/bills.ts) takes no template at all -- the gate
// was ONE boolean in this file, and it used to admit only "personal,"
// catching Student in the same net as Business. Student gets a real,
// recurring inflow and is the template this product leads with; Business
// stays excluded because irregular revenue makes "a paycheck" the wrong
// shape (the honest-money rule forbids faking a regular one).
function SeededTemplate({ template, withPayday }: { template: TemplateKey; withPayday?: boolean }) {
  const profile = useProfile();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await profile.save({
        template,
        ...(withPayday ? { payday: { amount: 500, next: todayISO(), freq: "biweekly" as const } } : {}),
      });
      await legacyBill(tasks, "Rent", { bill: { amount: 100 } });
      setReady(true);
    })();
  }, [profile, tasks, template, withPayday]);
  return ready ? <MoneyFlow /> : null;
}

describe("MoneyFlow: the budget half by template (S5-Q33)", () => {
  it("Personal offers Set Up Payday", async () => {
    render(<NotesProvider userId="t-personal"><SeededTemplate template="personal" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("Set Up Payday")).toBeInTheDocument();
  });

  it("Student offers Set Up Payday too -- it is not caught in Business's gate", async () => {
    render(<NotesProvider userId="t-student"><SeededTemplate template="student" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("Set Up Payday")).toBeInTheDocument();
  });

  it("Business gets no Set Up Payday row: irregular revenue is not a paycheck", async () => {
    render(<NotesProvider userId="t-business"><SeededTemplate template="business" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.queryByText("Set Up Payday")).not.toBeInTheDocument();
  });

  it("Student with a payday already set sees the real hero and Set Aside, same as Personal", async () => {
    render(<NotesProvider userId="t-student-pay"><SeededTemplate template="student" withPayday /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Set Aside")).toBeInTheDocument());
    expect(screen.getByText(/^Yours/)).toBeInTheDocument();
  });

  it("Business with a payday already set on the profile still shows no hero or Set Aside", async () => {
    render(<NotesProvider userId="t-business-pay"><SeededTemplate template="business" withPayday /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.queryByText("Set Aside")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Yours/)).not.toBeInTheDocument();
  });
});

// SHELL-F-21 (2026-09-05): search "Chase", tap the account row (which wears a
// chevron), and the Money tab opened on its normal first screen with the
// account neither opened nor highlighted. This tab had no deep-link prop at
// all; now it has the same one-shot every other tab has.
import { useMoney } from "../data/NotesProvider";

function AccountLink() {
  const money = useMoney();
  const [id, setId] = useState<string | undefined>(undefined);
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => {
    void (async () => { setId((await money.create({ name: "Chase Checking", balance: 1200, kind: "cash" })) ?? undefined); })();
  }, [money]);
  return id ? (
    <>
      <button onClick={() => setIntent((i) => ({ value: id, nonce: i.nonce + 1 }))}>Search Hit</button>
      <MoneyFlow
        openAccountId={intent.value}
        openNonce={intent.nonce}
        onOpenConsumed={() => setIntent((i) => ({ nonce: i.nonce }))}
      />
    </>
  ) : null;
}

// HMN-F-09 (2026-09-05): ten Money writes ran outside attemptWrite. A save on
// a bad connection latched the button on "Saving" with no toast and nothing
// stored, and Cancel (which throws the typing away) was the only way out.
import { MoneyService } from "./MoneyService";
import { LedgerService } from "./ledger/LedgerService";
import { subscribeToast, resetToasts } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

describe("Money writes that fail say so and give the button back (HMN-F-09)", () => {
  afterEach(() => { vi.restoreAllMocks(); resetToasts(); });

  it("a failed account save toasts, unlatches Save, and keeps what was typed", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(MoneyService.prototype, "create").mockRejectedValue(new Error("offline"));
    render(<NotesProvider userId="fail-acct"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    // The sheet is still here, the typing is still in it, and Save is a
    // button again rather than a permanent "Saving".
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Savings");
    stop();
  });

  it("a failed bill save toasts and unlatches Save", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(LedgerService.prototype, "addBill").mockRejectedValue(new Error("offline"));
    render(<NotesProvider userId="fail-bill"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Bill name") as HTMLInputElement).value).toBe("Electric");
    stop();
  });

  it("a failed mark paid says so instead of nothing", async () => {
    const seen: string[] = [];
    render(<NotesProvider userId="fail-paid"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Electric")).toBeInTheDocument());

    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    vi.spyOn(LedgerService.prototype, "markBillPaidByUser").mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByLabelText("Mark paid"));
    fireEvent.click(await screen.findByText("I Paid This"));
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    // Nothing was claimed: the bill is still unpaid and the confirm still open.
    expect(screen.queryByText(/^Paid \w{3} \d/)).not.toBeInTheDocument();
    stop();
  });
});

describe("a Money search hit opens the account (SHELL-F-21)", () => {
  it("opens that account, and a later visit to the tab does not", async () => {
    render(<NotesProvider userId="acct-f21"><AccountLink /></NotesProvider>);
    await screen.findByText("Chase Checking");
    expect(screen.queryByText("Edit Account")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Search Hit"));
    await waitFor(() => expect(screen.getByText("Edit Account")).toBeInTheDocument());
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Chase Checking");

    // Closed by hand, the link is spent: nothing reopens it.
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit Account")).not.toBeInTheDocument());
  });
});

// HMN-F-12 (2026-09-05), option A: Set Aside envelopes lived in this phone's
// localStorage, so the iPad showed a different Yours, Chat on a second device
// did not know they existed, and a new phone lost every one of them. They sit
// on the profile record now, beside the payday the same screen already reads.
let profRef: ReturnType<typeof useProfile> | null = null;
function SeededForEnvelopes() {
  const profile = useProfile();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      profRef = profile;
      await profile.save({ template: "personal", payday: { amount: 500, next: todayISO(), freq: "biweekly" as const } });
      // One bill, so the page is past its empty state and the budget half
      // (which is what Set Aside lives in) renders at all.
      await legacyBill(tasks, "Rent", { bill: { amount: 100 } });
      setReady(true);
    })();
  }, [profile, tasks]);
  return ready ? <MoneyFlow /> : null;
}

describe("Set Aside envelopes live on the profile (HMN-F-12)", () => {
  afterEach(() => { localStorage.clear(); resetToasts(); });

  it("a new envelope is written to the profile, not to this device", async () => {
    profRef = null;
    render(<NotesProvider userId="env-1"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Set Money Aside")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Set Money Aside"));
    fireEvent.change(screen.getByPlaceholderText("What For"), { target: { value: "Groceries" } });
    fireEvent.change(screen.getAllByPlaceholderText("0")[0]!, { target: { value: "300" } });
    // The set-aside is one sheet (Dave 2026-10-05: no form in a card); Save is its bar's.
    fireEvent.click(screen.getByText("Save"));

    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: expect.any(String), name: "Groceries", amount: 300 }]);
    });
    expect(localStorage.getItem("jarvis.money.envelopes.v1")).toBeNull();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("envelopes this phone already had are lifted onto the profile once, then forgotten here", async () => {
    profRef = null;
    localStorage.setItem("jarvis.money.envelopes.v1", JSON.stringify([{ id: "a", name: "Gas", amount: 120 }]));
    render(<NotesProvider userId="env-2"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());
    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: "a", name: "Gas", amount: 120 }]);
    });
    expect(localStorage.getItem("jarvis.money.envelopes.v1")).toBeNull();
  });

  it("removing one offers Undo, and Undo puts it back on the profile", async () => {
    profRef = null;
    const seen: string[] = [];
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t) { seen.push(t.message); undo = t.onAction; } });
    localStorage.setItem("jarvis.money.envelopes.v1", JSON.stringify([{ id: "a", name: "Gas", amount: 120 }]));
    render(<NotesProvider userId="env-3"><SeededForEnvelopes /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Remove Gas"));
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    await waitFor(() => expect(seen).toContain("Set Aside Removed"));
    await waitFor(async () => expect((await profRef!.get())!.envelopes).toEqual([]));

    undo?.();
    await waitFor(() => expect(screen.getByText("Gas")).toBeInTheDocument());
    await waitFor(async () => {
      expect((await profRef!.get())!.envelopes).toEqual([{ id: "a", name: "Gas", amount: 120 }]);
    });
    stop();
  });
});

// HMN-F-13 (2026-09-05), option A: a Credit account is money owed. The field
// asked for a "Balance" behind inputMode="numeric", and that keypad has no
// minus, so $2,000 owed went in as 2,000 and Total balance went UP by the
// size of the debt.
describe("a Credit account is a debt, typed as a plain number (HMN-F-13)", () => {
  it("asks what is Owed and takes it off the total", async () => {
    render(<NotesProvider userId="credit-1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Visa" } });
    // The field is Balance until the kind says otherwise.
    expect(screen.getByLabelText("Balance in dollars")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Account type"));
    fireEvent.click(await screen.findByText("Credit"));
    const owed = await screen.findByLabelText("Amount owed in dollars");
    fireEvent.change(owed, { target: { value: "2000" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("Total Balance")).toBeInTheDocument());
    // No minus was typed anywhere, and the total went down by the debt.
    expect(screen.getAllByText("-$2,000").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("$2,000")).not.toBeInTheDocument();
  });
});

// MONEY LEDGER (2026-10-03): receipts are records. Four ways in, none needing
// AI; Read It only ever fills the receipt sheet for the person to confirm.
import { useOptionalFiles, useLedger } from "../data/NotesProvider";
import { MemoryFileStore } from "../files/FileStore";
import type { FilesService } from "../files/FilesService";

const toasts: string[] = [];
let unsub: (() => void) | undefined;
function listenToasts() { toasts.length = 0; unsub?.(); unsub = subscribeToast((t) => { if (t) toasts.push(t.message); }); }

interface Handles { ledger: LedgerService; files: FilesService }
function Grab({ into, seedFile }: { into: { current?: Handles }; seedFile?: boolean }) {
  const ledger = useLedger();
  const files = useOptionalFiles()!;
  const [ready, setReady] = useState(!seedFile);
  useEffect(() => {
    into.current = { ledger, files };
    if (!seedFile) return;
    void files.create({ name: "corner-store.png", path: "p/corner-store.png", mime: "image/png", bytes: 10, scope: "money", addedAt: "2026-09-01" }).then(() => setReady(true));
  }, [ledger, files, into, seedFile]);
  return ready ? <MoneyFlow /> : null;
}

async function typeReceipt(vendor: string, amount: string) {
  fireEvent.click(await screen.findByLabelText("Add a Receipt"));
  expect(await screen.findByText("New Receipt")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: vendor } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: amount } });
  fireEvent.click(screen.getByText("Save"));
}

describe("Typing a receipt is the shortest way in", () => {
  afterEach(() => { vi.restoreAllMocks(); unsub?.(); });

  it("vendor, amount, Save: a record dated today, listed with its amount", async () => {
    listenToasts();
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-type"><Grab into={h} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    // The date opens on today and is editable; nothing else is required.
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(todayISO());
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Stop & Shop" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "47.12" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toHaveLength(1));
    const [r] = await h.current!.ledger.listReceipts();
    expect(r!.data).toMatchObject({ vendor: "Stop & Shop", amountCents: 4712, currency: "USD", transactionDate: todayISO(), source: "manual" });
    expect(r!.data.attachmentFileId).toBeUndefined();
    expect(await screen.findByText("Stop & Shop")).toBeInTheDocument();
    expect(screen.getByText("$47.12")).toBeInTheDocument();
    expect(toasts).toContain("Receipt Saved");
    // A receipt is never a bill.
    expect(await h.current!.ledger.listBills()).toEqual([]);
  });

  it("saving the same vendor, amount and date again is one record, and says Already Saved", async () => {
    listenToasts();
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-dup"><Grab into={h} /></NotesProvider>);
    await typeReceipt("Stop & Shop", "47.12");
    await waitFor(() => expect(toasts).toContain("Receipt Saved"));
    await typeReceipt("stop & shop", "47.12");
    await waitFor(() => expect(toasts).toContain("Already Saved"));
    expect(await h.current!.ledger.listReceipts()).toHaveLength(1);
  });

  it("a receipt with no vendor or amount does not save, and says what is missing", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-bad"><Grab into={h} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("A vendor and an amount")).toBeInTheDocument();
    expect(await h.current!.ledger.listReceipts()).toEqual([]);
  });

  it("the category opens on the one this vendor usually gets", async () => {
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-cat"><Grab into={h} /></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    await h.current!.ledger.addReceipt({ vendor: "Stop & Shop", amount: "10", transactionDate: "2026-09-01", category: "Groceries" }, "manual", todayISO());
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Stop and Shop" } });
    // "Stop and Shop" is not the same normalised vendor as "Stop & Shop": no guess
    expect(screen.getByText("None", { selector: ".dd *, .dd" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "STOP & SHOP" } });
    await waitFor(() => expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.00" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toHaveLength(2));
    const added = (await h.current!.ledger.listReceipts()).find((r) => r.data.amountCents === 1200)!;
    expect(added.data.category).toBe("Groceries");
  });
});

// CLICK-THROUGH AUDIT 2026-09-29: "Add a Receipt: no form or picker opens".
// The phone's picker draws outside the page, so what can be pinned is that the
// row opens the hidden file input inside its own tap (a picker opened after an
// await is blocked by iOS), and that the file it returns is kept with the receipt.
describe("Take a Photo and Attach a File open the picker inside the tap", () => {
  afterEach(() => { vi.restoreAllMocks(); unsub?.(); });

  it("opens the sheet first, then the picker synchronously, and the file is kept with the record", async () => {
    listenToasts();
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    vi.spyOn(MemoryFileStore.prototype, "url").mockResolvedValue("blob:receipt");
    vi.spyOn(MemoryFileStore.prototype, "upload").mockResolvedValue({ path: "u/lunch.png", name: "lunch.png", mime: "image/png", bytes: 1 });
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-attach"><Grab into={h} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    expect(clicks, "nothing opens until a row is tapped").toHaveLength(0);

    fireEvent.click(screen.getByText("Attach a File"));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.type).toBe("file");
    expect(clicks[0]!.accept).toContain("image/*");
    expect(clicks[0]!.accept).toContain("application/pdf");
    expect(clicks[0]!.isConnected, "the input outlives the tap").toBe(true);

    fireEvent.click(screen.getByText("Take a Photo"));
    expect(clicks).toHaveLength(2);
    expect(clicks[1]!.getAttribute("capture")).toBe("environment");
    expect(clicks[1]!.accept).toBe("image/*");

    // Choosing a file attaches it; saving keeps the file row and names it on the record.
    fireEvent.change(clicks[0]!, { target: { files: [new File(["x"], "lunch.png", { type: "image/png" })] } });
    expect(await screen.findByText("lunch.png")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Corner Cafe" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toHaveLength(1));
    const [r] = await h.current!.ledger.listReceipts();
    const stored = await h.current!.files.list("money");
    expect(stored).toHaveLength(1);
    expect(r!.data.attachmentFileId).toBe(stored[0]!.id);
    expect(stored[0]!.data.path).toBe("u/lunch.png");
    // It shows through the record, not again as a loose file.
    await screen.findByText("Corner Cafe");
    expect(screen.queryByText("Files")).toBeNull();
  });

  it("a duplicate save does not leave its second photo behind", async () => {
    listenToasts();
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    vi.spyOn(MemoryFileStore.prototype, "url").mockResolvedValue("blob:receipt");
    vi.spyOn(MemoryFileStore.prototype, "upload").mockResolvedValue({ path: "u/again.png", name: "again.png", mime: "image/png", bytes: 1 });
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-dup-photo"><Grab into={h} /></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    await h.current!.ledger.addReceipt({ vendor: "Corner Cafe", amount: "12.50", transactionDate: todayISO() }, "manual", todayISO());
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    fireEvent.click(screen.getByText("Attach a File"));
    fireEvent.change(clicks[0]!, { target: { files: [new File(["x"], "again.png", { type: "image/png" })] } });
    await screen.findByText("again.png");
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Corner Cafe" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(toasts).toContain("Already Saved"));
    expect(await h.current!.ledger.listReceipts()).toHaveLength(1);
    expect(await h.current!.files.list("money")).toEqual([]);
  });

  it("Cancel closes the sheet without opening a picker", async () => {
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-cancel"><Grab into={h} /></NotesProvider>);
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("New Receipt")).toBeNull();
    expect(clicks).toHaveLength(0);
  });
});

describe("Read It proposes a receipt; the person confirms", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); aiState.available = false; aiState.reply = ""; unsub?.(); });

  it("on a file uploaded earlier, it fills the receipt sheet and saves nothing until Save", async () => {
    aiState.available = true;
    aiState.reply = '{"vendor":"Corner Store","total":42.75,"date":"2026-09-03","currency":"USD"}';
    vi.spyOn(MemoryFileStore.prototype, "url").mockResolvedValue("blob:receipt");
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) })));
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="receipt-read"><Grab into={h} seedFile /></NotesProvider>);

    const readIt = await screen.findByLabelText("Read It corner-store.png");
    await waitFor(() => {
      if (!screen.queryByText("New Receipt")) fireEvent.click(readIt);
      expect(screen.getByText("New Receipt")).toBeInTheDocument();
    });
    expect((screen.getByLabelText("Vendor") as HTMLInputElement).value).toBe("Corner Store");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("42.75");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-03");
    // A candidate, not a record, and never a bill.
    expect(await h.current!.ledger.listReceipts()).toEqual([]);
    expect(await h.current!.ledger.listBills()).toEqual([]);

    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toHaveLength(1));
    const [r] = await h.current!.ledger.listReceipts();
    const file = (await h.current!.files.list("money"))[0]!;
    expect(r!.data).toMatchObject({ vendor: "Corner Store", amountCents: 4275, transactionDate: "2026-09-03", attachmentFileId: file.id });
    // The file now belongs to the record: it is no longer listed twice.
    await waitFor(() => expect(screen.queryByLabelText("Read It corner-store.png")).toBeNull());
    expect(await h.current!.ledger.listBills()).toEqual([]);
  });

  it("a read that finds no receipt says so and opens nothing", async () => {
    listenToasts();
    aiState.available = true;
    aiState.reply = "I cannot read that";
    vi.spyOn(MemoryFileStore.prototype, "url").mockResolvedValue("blob:receipt");
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) })));
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="receipt-read-miss"><Grab into={h} seedFile /></NotesProvider>);
    const readIt = await screen.findByLabelText("Read It corner-store.png");
    await waitFor(() => {
      // The URL resolves a beat after the row; Read It waits for it.
      if (!toasts.some((t) => t.startsWith("Couldn't Read That"))) fireEvent.click(readIt);
      expect(toasts.some((t) => t.startsWith("Couldn't Read That"))).toBe(true);
    });
    expect(screen.queryByText("New Receipt")).toBeNull();
  });

  it("with AI off, Read It is not offered on a file or inside the sheet", async () => {
    aiState.available = false;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="receipt-ai-off"><Grab into={h} seedFile /></NotesProvider>);
    await screen.findByText("corner-store.png");
    expect(screen.queryByLabelText("Read It corner-store.png")).toBeNull();
    // Typing still works, and an attached photo offers no read.
    await typeReceipt("Cafe", "5");
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toHaveLength(1));
    fireEvent.click(await screen.findByLabelText("Add a Receipt"));
    await screen.findByText("New Receipt");
    expect(screen.queryByText("Read It")).toBeNull();
  });
});

describe("A receipt's own sheet", () => {
  afterEach(() => { vi.restoreAllMocks(); unsub?.(); });

  it("edits through a correction that shows in its history, and delete has an Undo", async () => {
    const actions: Array<(() => void) | undefined> = [];
    toasts.length = 0;
    unsub?.();
    unsub = subscribeToast((t) => { if (t) { toasts.push(t.message); actions.push(t.onAction); } });
    const h: { current?: Handles } = {};
    render(<NotesProvider userId="rc-detail"><Grab into={h} /></NotesProvider>);
    await waitFor(() => expect(h.current).toBeTruthy());
    const made = await h.current!.ledger.addReceipt({ vendor: "Cafe", amount: "5.00", transactionDate: "2026-09-08" }, "manual", todayISO());
    if (!made.ok) throw new Error("seed");

    fireEvent.click(await screen.findByText("Cafe"));
    await screen.findByText("Not Matched");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "6.50" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect((await h.current!.ledger.getReceipt(made.id))!.data.amountCents).toBe(650));
    const after = (await h.current!.ledger.getReceipt(made.id))!;
    expect(after.data.history.map((x) => x.action)).toEqual(["created", "corrected"]);

    // History is readable on the sheet.
    fireEvent.click(await screen.findByText("Cafe"));
    expect(await screen.findByText("Amount $5.00 to $6.50")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Delete Receipt"));
    await waitFor(async () => expect(await h.current!.ledger.listReceipts()).toEqual([]));
    expect(toasts).toContain("Receipt Deleted");
    actions[actions.length - 1]!();
    await waitFor(async () => expect((await h.current!.ledger.getReceipt(made.id))?.data.amountCents).toBe(650));
  });
});
