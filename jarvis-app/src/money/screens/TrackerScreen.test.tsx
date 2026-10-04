// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTracker } from "../../data/NotesProvider";
import type { LedgerService } from "../ledger/LedgerService";
import type { TrackerService } from "../TrackerService";
import { subscribeToast, resetToasts, type ToastState } from "../../shared/toast";
import { DEFAULT_BUDGET_CATEGORIES } from "../ledger/types";
import { monthLabel, thisMonth, type TrackerTxData } from "../tracker";
import TrackerScreen from "./TrackerScreen";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const MONTH = thisMonth();
const day = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const TODAY = day(15);
interface Handles { ledger: LedgerService; tracker: TrackerService }
const tx = (over: Partial<TrackerTxData>): TrackerTxData => ({
  date: day(8), month: MONTH, merchant: "Stop & Shop", name: "STOP & SHOP #123", amountCents: 4712, category: "Groceries", account: "", ...over,
});

const toasts: ToastState[] = [];
let off: () => void;
beforeEach(() => { localStorage.clear(); resetToasts(); toasts.length = 0; off = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => off());

/** Seeds through the services first, then mounts the screen, which reads once on mount. */
function Harness({ into, seed }: { into: { current?: Handles }; seed?: (h: Handles) => Promise<void> }) {
  const ledger = useLedger();
  const tracker = useTracker();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    into.current = { ledger, tracker };
    void (async () => { await seed?.({ ledger, tracker }); setReady(true); })();
  }, [ledger, tracker, into, seed]);
  return ready ? <TrackerScreen onBack={() => {}} /> : null;
}
const mount = (id: string, seed?: (h: Handles) => Promise<void>) => {
  const h: { current?: Handles } = {};
  render(<NotesProvider userId={id}><Harness into={h} seed={seed} /></NotesProvider>);
  return h;
};
const tab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }, { timeout: 4000 }));

const seedPair = async (h: Handles) => {
  const txId = (await h.tracker.saveTx(null, tx({})))!;
  const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: day(8), category: "Groceries" }, "manual", TODAY);
  if (!r.ok) throw new Error("seed");
  const a = await h.ledger.approveReceiptMatch(r.id, txId);
  if (!a.ok) throw new Error("link");
  return { txId, receiptId: r.id };
};

describe("Tracker transactions: added by hand, no bank", () => {
  it("says Add Manually, never offers a bank connection", async () => {
    mount("tr-copy");
    await tab("Transactions");
    expect(await screen.findByText("Add Manually")).toBeInTheDocument();
    expect(screen.getByText("Nothing Tracked Yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/connect (a )?bank|link (a )?bank|sync/i);
    expect(screen.queryByText("Add a Transaction")).toBeNull();
  });

  it("a new transaction opens on the category its merchant usually gets", async () => {
    const h = mount("tr-cat", async (s) => { await s.tracker.saveTx(null, tx({ date: day(1), category: "Household" })); });
    await tab("Transactions");
    fireEvent.click(await screen.findByText("Add Manually"));
    await screen.findByText("New Transaction");
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "stop & shop" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "20.00" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs).toHaveLength(2));
    const made = (await h.current!.tracker.load()).txs.find((t) => t.data.amountCents === 2000)!;
    expect(made.data.category).toBe("Household");
    expect(made.data.source).toBe("manual");
    expect(made.data.history![0]).toMatchObject({ action: "created", by: "user" });
  });

  it("editing a matched transaction keeps its links and appends a history line", async () => {
    const h = mount("tr-edit", async (s) => { await seedPair(s); });
    await tab("Transactions");
    // the row says it is matched
    const row = (await screen.findByText("Stop & Shop")).closest(".row") as HTMLElement;
    expect(within(row).getByText("Matched")).toBeInTheDocument();
    fireEvent.click(row);
    await screen.findByText("Edit Transaction");
    // once as the sheet's Match row, once as the line the link wrote in its history
    expect(screen.getAllByText("Matched to a Receipt")).toHaveLength(2);
    expect(screen.getByText("Unmatch")).toBeInTheDocument();
    const before = (await h.current!.tracker.load()).txs[0]!.data;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "60.00" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs[0]!.data.amountCents).toBe(6000));
    const after = (await h.current!.tracker.load()).txs[0]!.data;
    expect(after.matchedReceiptId).toBe(before.matchedReceiptId);
    expect(after.currency).toBe(before.currency);
    expect(after.source).toBe("manual");
    expect(after.history!.map((x) => x.action)).toEqual(["created", "matched to a receipt", "corrected"]);
    expect(after.history![2]!.changes).toEqual({ amountCents: { from: 4712, to: 6000 } });
  });

  it("the sheet shows the history, and Unmatch frees the receipt with an Undo", async () => {
    const h = mount("tr-unmatch", async (s) => { await seedPair(s); });
    await tab("Transactions");
    fireEvent.click((await screen.findByText("Stop & Shop")).closest(".row")!);
    await screen.findByText("Edit Transaction");
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getAllByText("Matched to a Receipt").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Unmatch"));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs[0]!.data.matchedReceiptId).toBeUndefined());
    const [r] = await h.current!.ledger.listReceipts();
    expect(r!.data.linkedTransactionId).toBeUndefined();
    const done = toasts.find((t) => t.message === "Unmatched");
    expect(done?.actionLabel).toBe("Undo");
    done!.onAction!();
    await waitFor(async () => expect((await h.current!.ledger.listReceipts())[0]!.data.linkedTransactionId).toBeTruthy());
  });

  it("deleting a matched payment frees its receipt, and Undo puts both back", async () => {
    const h = mount("tr-delete", async (s) => { await seedPair(s); });
    await tab("Transactions");
    fireEvent.click((await screen.findByText("Stop & Shop")).closest(".row")!);
    fireEvent.click(await screen.findByText("Delete Transaction"));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs).toHaveLength(0));
    expect((await h.current!.ledger.listReceipts())[0]!.data.linkedTransactionId).toBeUndefined();
    const done = toasts.find((t) => t.message === "Transaction Deleted")!;
    done.onAction!();
    await waitFor(async () => expect((await h.current!.tracker.load()).txs).toHaveLength(1));
    await waitFor(async () => expect((await h.current!.ledger.listReceipts())[0]!.data.linkedTransactionId).toBe((await h.current!.tracker.load()).txs[0]!.id));
  });

  it("proposals sit above the transactions, and Link updates the rows", async () => {
    const h = mount("tr-matches", async (s) => {
      await s.tracker.saveTx(null, tx({}));
      await s.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: day(8) }, "manual", TODAY);
    });
    await tab("Transactions");
    expect(await screen.findByText("Matches")).toBeInTheDocument();
    const rowText = await screen.findByText(/Looks Like Your/);
    // above the Transactions head in document order
    const head = screen.getByText("Transactions", { selector: ".sh2 .t" });
    expect(rowText.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByText("Link"));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs[0]!.data.matchedReceiptId).toBeTruthy());
    expect(await screen.findByText("Matched")).toBeInTheDocument();
  });
});

describe("Dashboard counts what the Budget counts (Dave 2026-10-03)", () => {
  it("Out and Spending by Category include a standalone receipt, and match the Budget total", async () => {
    mount("dash-receipt", async (h) => {
      await h.tracker.saveTx(null, tx({ date: day(2), merchant: "Cafe", name: "CAFE", amountCents: 1000, category: "Dining" }));
      const r = await h.ledger.addReceipt({ vendor: "Hardware", amount: "25.00", transactionDate: day(5), category: "Home" }, "manual", TODAY);
      if (!r.ok) throw new Error("seed");
    });
    // The dashboard is the first tab.
    expect(await screen.findByText("$35.00", undefined, { timeout: 4000 })).toBeInTheDocument();   // Out
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    await tab("Budgets");
    expect((await screen.findAllByText("$35.00")).length).toBeGreaterThan(0);                       // Spent
  });

  it("a receipt linked to a payment is one amount on the Dashboard", async () => {
    mount("dash-pair", async (h) => { await seedPair(h); });
    expect(await screen.findAllByText("$47.12", undefined, { timeout: 4000 })).not.toHaveLength(0);
    expect(screen.queryByText("$94.24")).toBeNull();
  });
});

describe("a new month's budget copies last month's limits (Dave 2026-10-03)", () => {
  it("opens with the previous budget's names and limits, says so, and stores nothing until Save", async () => {
    const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
    const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const h = mount("bg-copy", async (s) => {
      await s.tracker.saveBudget({ month: prevMonth, expectedIncomeCents: 500000, savingsTargetCents: 100000, allocations: { Golf: 20000, Restaurants: 45050 } });
    });
    await tab("Budgets");
    expect((await screen.findByLabelText("Golf limit") as HTMLInputElement).value).toBe("200.00");
    expect((screen.getByLabelText("Restaurants limit") as HTMLInputElement).value).toBe("450.50");
    expect(screen.queryByLabelText("Dining limit")).toBeNull();               // not the nine proposed names
    expect(screen.getByText(`Limits Copied From ${monthLabel(prevMonth)}`)).toBeInTheDocument();
    // income and savings target are the person's to say again
    expect((screen.getByLabelText("Expected income") as HTMLInputElement).value).toBe("");
    // nothing stored for this month until Save
    expect((await h.current!.tracker.load()).budgets.filter((b) => b.data.month === MONTH)).toHaveLength(0);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      const saved = (await h.current!.tracker.load()).budgets.find((b) => b.data.month === MONTH);
      expect(saved?.data.allocations).toEqual({ Golf: 20000, Restaurants: 45050 });
    });
  });
});

describe("Tracker budget: monthly, on actuals", () => {
  it("a month with no budget starts from the nine names with blank limits", async () => {
    mount("bg-seed");
    await tab("Budgets");
    for (const name of DEFAULT_BUDGET_CATEGORIES) {
      const limit = await screen.findByLabelText(`${name} limit`);
      expect((limit as HTMLInputElement).value).toBe("");
    }
    // Uncategorized is always at the foot
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  it("filling a limit and saving stores cents by name, with the month as its name", async () => {
    const h = mount("bg-save");
    await tab("Budgets");
    fireEvent.change(await screen.findByLabelText("Groceries limit"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Dining limit"), { target: { value: "75.50" } });
    fireEvent.click(screen.getByText("Save", { selector: ".pill-act" }));
    await waitFor(async () => expect((await h.current!.tracker.load()).budgets).toHaveLength(1));
    const b = (await h.current!.tracker.load()).budgets[0]!.data;
    expect(b.allocations).toEqual({ Groceries: 20000, Dining: 7550 });
    expect(b.month).toBe(MONTH);
    expect(b.name).toBe(monthLabel(MONTH));
  });

  it("rename, add and remove are free text and save as written", async () => {
    const h = mount("bg-edit");
    await tab("Budgets");
    fireEvent.change(await screen.findByLabelText("Groceries name"), { target: { value: "Food" } });
    fireEvent.change(screen.getByLabelText("Food limit"), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText("Remove Dining"));
    fireEvent.click(screen.getByText("Add a Category"));
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "Pets" } });
    fireEvent.change(screen.getByLabelText("Pets limit"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save", { selector: ".pill-act" }));
    await waitFor(async () => expect((await h.current!.tracker.load()).budgets).toHaveLength(1));
    expect((await h.current!.tracker.load()).budgets[0]!.data.allocations).toEqual({ Food: 30000, Pets: 4000 });
  });

  it("an existing budget keeps working unchanged: its allocations, no proposed names", async () => {
    mount("bg-existing", async (s) => {
      await s.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 500000, savingsTargetCents: 100000, allocations: { Golf: 20000, Restaurants: 45050 } });
    });
    await tab("Budgets");
    expect((await screen.findByLabelText("Golf limit") as HTMLInputElement).value).toBe("200.00");
    expect((screen.getByLabelText("Restaurants limit") as HTMLInputElement).value).toBe("450.50");
    expect(screen.queryByLabelText("Dining limit")).toBeNull();
    expect((screen.getByLabelText("Expected income") as HTMLInputElement).value).toBe("5000.00");
  });

  it("shows limit, spent, remaining, the over line, and Uncategorized last", async () => {
    mount("bg-actuals", async (s) => {
      await s.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 0, savingsTargetCents: 0, allocations: { Groceries: 10000, Dining: 5000 } });
      await s.tracker.saveTx(null, tx({ merchant: "Market", amountCents: 6000, category: "Groceries" }));
      await s.tracker.saveTx(null, tx({ merchant: "Cafe", amountCents: 9000, category: "Dining" }));
      await s.tracker.saveTx(null, tx({ merchant: "Mystery", amountCents: 1234, category: "" }));
    });
    await tab("Budgets");
    expect(await screen.findByText("$60.00 of $100.00")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();   // remaining on Groceries
    expect(screen.getByText("$40.00 Over")).toBeInTheDocument(); // Dining, stated plainly (Title Case, as every line is)
    const names = [...document.querySelectorAll(".mt-cat-name")].map((n) => n.textContent);
    expect(names[names.length - 1]).toBe("Uncategorized");
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  it("a linked pair counts once at the payment, and a differing receipt is stated plainly", async () => {
    mount("bg-pair", async (s) => {
      await s.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 0, savingsTargetCents: 0, allocations: { Groceries: 20000 } });
      const txId = (await s.tracker.saveTx(null, tx({ amountCents: 6000 })))!;
      const r = await s.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: day(8), category: "Groceries" }, "manual", TODAY);
      if (!r.ok) throw new Error("seed");
      await s.ledger.approveReceiptMatch(r.id, txId);
    });
    await tab("Budgets");
    expect(await screen.findByText("$60.00 of $200.00")).toBeInTheDocument();
    expect(screen.getByText("Receipt Says $47.12, Payment Says $60.00")).toBeInTheDocument();
    expect(screen.getByText("Counting the Payment")).toBeInTheDocument();
  });

  it("is monthly only and never forecasts", async () => {
    mount("bg-nopredict", async (s) => {
      await s.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 0, savingsTargetCents: 0, allocations: { Groceries: 10000 } });
      await s.tracker.saveTx(null, tx({ amountCents: 6000 }));
    });
    await tab("Budgets");
    await screen.findByText("$60.00 of $100.00");
    expect(document.body.textContent).not.toMatch(/pace|project|forecast|on track|at this rate|will run|weekly|per week/i);
  });
});

// ADD SAYS WHAT IS MISSING (2026-10-04, the dead-button sweep). Add on a new
// subscription returned without a word when the name or the amount was empty,
// so the row looked dead. It names what is missing and puts the cursor there.
describe("Tracker subscriptions: Add with something missing", () => {
  const messages = () => toasts.map((t) => t.message);
  const tapAdd = () => fireEvent.click(screen.getByText("Add", { selector: ".pill-act" }));
  const open = async (id: string) => {
    const h = mount(id);
    await tab("Subscriptions");
    await screen.findByLabelText("New subscription name");
    return h;
  };

  it("nothing typed: says a name and an amount, and the cursor goes to the name", async () => {
    const h = await open("sub-none");
    tapAdd();
    expect(messages()).toContain("Add a Name and an Amount");
    expect(screen.getByLabelText("New subscription name")).toHaveFocus();
    expect((await h.current!.tracker.load()).subs).toHaveLength(0);
  });

  it("a name and no amount: says the amount, and the cursor goes to the amount", async () => {
    const h = await open("sub-name");
    fireEvent.change(screen.getByLabelText("New subscription name"), { target: { value: "Netflix" } });
    tapAdd();
    expect(messages()).toContain("Add an Amount First");
    expect(screen.getByLabelText("New subscription amount")).toHaveFocus();
    expect((await h.current!.tracker.load()).subs).toHaveLength(0);
  });

  it("an amount and no name: says the name, and the cursor goes to the name", async () => {
    const h = await open("sub-amount");
    fireEvent.change(screen.getByLabelText("New subscription amount"), { target: { value: "15.99" } });
    tapAdd();
    expect(messages()).toContain("Add a Name First");
    expect(screen.getByLabelText("New subscription name")).toHaveFocus();
    expect((await h.current!.tracker.load()).subs).toHaveLength(0);
  });

  it("a complete row still saves, with no complaint", async () => {
    const h = await open("sub-ok");
    fireEvent.change(screen.getByLabelText("New subscription name"), { target: { value: "Netflix" } });
    fireEvent.change(screen.getByLabelText("New subscription amount"), { target: { value: "15.99" } });
    tapAdd();
    await waitFor(async () => expect((await h.current!.tracker.load()).subs).toHaveLength(1));
    expect(messages().filter((m) => /^Add a|^Add an/.test(m))).toEqual([]);
  });
});

// A BUDGET LIMIT WITH NO NAME IS NOT DROPPED UNDER "BUDGET SAVED" (2026-10-04).
// A blank row and a name with no limit are left out on purpose; a limit typed
// against no name is something he entered and used to vanish in silence.
describe("Tracker budgets: a limit with no name", () => {
  it("says to name it, puts the cursor on the name, and saves nothing", async () => {
    const h = mount("bg-unnamed");
    await tab("Budgets");
    fireEvent.click(await screen.findByText("Add a Category"));
    fireEvent.change(screen.getByLabelText("New category limit"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save", { selector: ".pill-act" }));
    expect(toasts.map((t) => t.message)).toContain("Name That Category First");
    expect(screen.getByLabelText("New category name")).toHaveFocus();
    expect((await h.current!.tracker.load()).budgets).toHaveLength(0);
    expect(toasts.map((t) => t.message)).not.toContain("Budget Saved");
  });

  it("a blank row and a name with no limit are still left out, as before", async () => {
    const h = mount("bg-blank");
    await tab("Budgets");
    fireEvent.click(await screen.findByText("Add a Category"));
    fireEvent.change(await screen.findByLabelText("Groceries limit"), { target: { value: "200" } });
    fireEvent.click(screen.getByText("Save", { selector: ".pill-act" }));
    await waitFor(async () => expect((await h.current!.tracker.load()).budgets).toHaveLength(1));
    expect((await h.current!.tracker.load()).budgets[0]!.data.allocations).toEqual({ Groceries: 20000 });
    expect(toasts.map((t) => t.message)).not.toContain("Name That Category First");
  });
});
