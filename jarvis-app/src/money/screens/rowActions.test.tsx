// @vitest-environment jsdom
// THE ROW-ACTION MODEL ON THE TRACKER AND THE RECEIPTS (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC.md). Section-level
// actions (Add Account, Add Manually, Add a Category, Add a Subscription) sit on their section's head, a row is clean
// (its tap is its sheet, its swipe the one verb, its long press the menu), and a card holding only an action is not drawn.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTracker } from "../../data/NotesProvider";
import type { LedgerService } from "../ledger/LedgerService";
import type { TrackerService } from "../TrackerService";
import { subscribeToast, resetToasts, type ToastState } from "../../shared/toast";
import { thisMonth, type TrackerTxData } from "../tracker";
import { capsulesInCards, loneActionBoxes } from "../../laws/catalogCheck";
import TrackerScreen from "./TrackerScreen";
import ReceiptsSection from "./ReceiptsSection";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const MONTH = thisMonth();
const day = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
interface Handles { ledger: LedgerService; tracker: TrackerService }
const tx = (over: Partial<TrackerTxData> = {}): TrackerTxData => ({
  date: day(8), month: MONTH, merchant: "stop & shop", name: "STOP & SHOP #123", amountCents: 4712, category: "Groceries", account: "", ...over,
});
const CAPSULE = ".pill-act, .row-act, .btn-sm, .quiet-action";
// The September import is a notice with its own words (the settled notice card keeps its capsule); every other capsule in a card
// or a row is a violation.
const strays = (c: HTMLElement) => capsulesInCards(c).filter((x) => !x.startsWith("Import @"));

const toasts: ToastState[] = [];
let off: () => void;
beforeEach(() => { localStorage.clear(); resetToasts(); toasts.length = 0; off = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => { off(); cleanup(); vi.restoreAllMocks(); });

function Harness({ into, seed, children }: { into: { current?: Handles }; seed?: (h: Handles) => Promise<void>; children: React.ReactNode }) {
  const ledger = useLedger();
  const tracker = useTracker();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    into.current = { ledger, tracker };
    void (async () => { await seed?.({ ledger, tracker }); setReady(true); })();
  }, [ledger, tracker, into, seed]);
  return ready ? <>{children}</> : null;
}
const mount = (id: string, seed?: (h: Handles) => Promise<void>, ui: React.ReactNode = <TrackerScreen onBack={() => {}} />) => {
  const h: { current?: Handles } = {};
  const r = render(<NotesProvider userId={id}><Harness into={h} seed={seed}>{ui}</Harness></NotesProvider>);
  return { h, ...r };
};
const tab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }, { timeout: 4000 }));
const headOf = (c: HTMLElement, title: string) => [...c.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === title) as HTMLElement;

describe("Tracker > Dashboard: Add Account is the Accounts head's capsule", () => {
  it("no Add an Account row in a card; with no account the section is its head and the capsule alone", async () => {
    const { container } = mount("tra-acct");
    await screen.findByRole("tab", { name: "Overview" }, { timeout: 4000 });
    const head = headOf(container, "Accounts");
    expect(within(head).getByRole("button", { name: "Add Account" })).toHaveClass("pill-action");
    expect(screen.queryByText("Add an Account")).toBeNull();
    // The old grey card that held only the Add pill is not drawn (rule 12).
    expect(head.nextElementSibling?.querySelector(".card") ?? null).toBeNull();
    expect(loneActionBoxes(container)).toEqual([]);
    fireEvent.click(within(head).getByRole("button", { name: "Add Account" }));
    expect(await screen.findByText("New Account")).toBeInTheDocument();
  });

  it("an account's name is shown in Title Case", async () => {
    mount("tra-acct-case", async (h) => { await h.tracker.saveAccount(null, { name: "everyday checking", type: "checking", currentBalanceCents: 100, availableBalanceCents: 0 }); });
    expect(await screen.findByText("Everyday Checking")).toBeInTheDocument();
  });
});

describe("Tracker > Transactions: a clean row and a head that holds Add Manually", () => {
  it("Add Manually is on the head, never at the foot of the card; the row has no capsule; the merchant is in Title Case", async () => {
    const { container } = mount("tra-tx", async (h) => { await h.tracker.saveTx(null, tx()); });
    await tab("Activity");
    const head = headOf(container, "Transactions");
    await waitFor(() => expect(within(head).getByRole("button", { name: "Add Manually" })).toHaveClass("pill-action"));
    expect(container.querySelector(".row-act")).toBeNull();
    const row = (await screen.findByText("Stop & Shop", { selector: ".task-name" })).closest(".task-row") as HTMLElement;
    expect(row.querySelector(CAPSULE)).toBeNull();
    expect(strays(container)).toEqual([]);
    fireEvent.click(within(head).getByRole("button", { name: "Add Manually" }));
    expect(await screen.findByText("New Transaction")).toBeInTheDocument();
  });

  it("with nothing tracked the section is its head and the capsule: no card at all", async () => {
    const { container } = mount("tra-tx-empty");
    await tab("Activity");
    const head = headOf(container, "Transactions");
    expect(within(head).getByRole("button", { name: "Add Manually" })).toBeInTheDocument();
    expect(head.nextElementSibling?.querySelector(".card") ?? null).toBeNull();
    expect(loneActionBoxes(container)).toEqual([]);
  });

  it("a payment's swipe is Delete with its Undo, and its long-press menu is Edit and Delete", async () => {
    const { h, container } = mount("tra-tx-swipe", async (s) => { await s.tracker.saveTx(null, tx()); });
    await tab("Activity");
    const row = (await screen.findByText("Stop & Shop", { selector: ".task-name" })).closest(".task-row") as HTMLElement;
    fireEvent.contextMenu(row);
    const labels = (await screen.findAllByRole("button")).filter((b) => b.closest(".action-sheet")).map((b) => b.textContent);
    expect(labels).toEqual(["Edit", "Delete", "Cancel"]);
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(within(row.closest(".task-swipe") as HTMLElement).getByRole("button", { name: "Delete Stop & Shop" }));
    await waitFor(async () => expect((await h.current!.tracker.load()).txs).toHaveLength(0));
    expect(toasts.find((t) => t.message === "Transaction Deleted")?.actionLabel).toBe("Undo");
    expect(strays(container)).toEqual([]);
  });
});

describe("Tracker > Budgets: Add a Category is the head's, Save is the screen's one filled primary", () => {
  it("no row-act or pill in any card; Save This Month is a .btn-primary outside every card", async () => {
    const { container } = mount("tra-budget");
    await tab("Budgets");
    const head = await waitFor(() => headOf(container, "Categories"));
    expect(within(head).getByRole("button", { name: "Add a Category" })).toHaveClass("pill-action");
    expect(container.querySelector(".row-act, .list-card-ruled .pill-act, .task-row .pill-act")).toBeNull();
    const save = screen.getByRole("button", { name: "Save This Month" });
    expect(save).toHaveClass("btn-primary");
    expect(save.closest(".card, .list-card-ruled, .row")).toBeNull();
    fireEvent.click(within(head).getByRole("button", { name: "Add a Category" }));
    expect(await screen.findByLabelText("New category name")).toBeInTheDocument();
  });
});

describe("Tracker > Subscriptions: the verb is the swipe, the add is the head's capsule and a sheet", () => {
  it("a subscription row has no Cancel button: its swipe is Cancel, then Restart once cancelled, and Delete follows", async () => {
    const { h, container } = mount("tra-subs", async (s) => { await s.tracker.saveSub(null, { merchantName: "netflix", amountCents: 1599, frequency: "Monthly", status: "active" }); });
    await tab("Subscriptions");
    const row = (await screen.findByText("Netflix", { selector: ".task-name" })).closest(".task-row") as HTMLElement;
    expect(row.querySelector(CAPSULE)).toBeNull();
    const swipe = row.closest(".task-swipe") as HTMLElement;
    expect(within(swipe).getByRole("button", { name: "Cancel Netflix" })).toHaveClass("task-verb");
    expect(within(swipe).getByRole("button", { name: "Delete Netflix" })).toHaveClass("task-del");
    fireEvent.click(within(swipe).getByRole("button", { name: "Cancel Netflix" }));
    await waitFor(async () => expect((await h.current!.tracker.load()).subs[0]!.data.status).toBe("cancelled"));
    const again = (await screen.findByText("Netflix", { selector: ".task-name" })).closest(".task-swipe") as HTMLElement;
    expect(within(again).getByRole("button", { name: "Restart Netflix" })).toHaveClass("task-verb");
    expect(strays(container)).toEqual([]);
  });

  it("the Add One card is gone: Add a Subscription is the head's capsule and opens the sheet", async () => {
    const { container } = mount("tra-subs-add");
    await tab("Subscriptions");
    const head = await waitFor(() => headOf(container, "Subscriptions"));
    expect(screen.queryByText("Add One")).toBeNull();
    expect(screen.queryByLabelText("New subscription name")).toBeNull();
    fireEvent.click(within(head).getByRole("button", { name: "Add a Subscription" }));
    expect(await screen.findByText("New Subscription")).toBeInTheDocument();
    expect(loneActionBoxes(container)).toEqual([]);
  });
});

describe("Tracker > the September import is a notice with its own words, not a row with a pill", () => {
  it("the offer is the settled notice card; its tap and its Import do the same, and it is no list row", async () => {
    const { container } = mount("tra-import");
    const card = await waitFor(() => { const c = container.querySelector(".notice-card"); if (!c) throw new Error("no notice"); return c as HTMLElement; });
    expect(within(card).getByText("Import September Data")).toBeInTheDocument();
    expect(card.closest(".task-row, .list-card-ruled")).toBeNull();
    expect(within(card).getByRole("button", { name: "Import" })).toHaveClass("pill-act");
  });
});

describe("Receipts: a clean row, Delete behind the swipe, his vendor in Title Case", () => {
  it("a receipt row has no capsule and no trash button; its tap opens the receipt's sheet", async () => {
    const { container } = mount("tra-rcpt", async (h) => {
      const r = await h.ledger.addReceipt({ vendor: "corner store", amount: "12.00", transactionDate: day(3), category: "Groceries" }, "manual", day(3));
      if (!r.ok) throw new Error("seed");
    }, <ReceiptsSection />);
    const row = (await screen.findByText("Corner Store", { selector: ".task-name" })).closest(".task-row") as HTMLElement;
    expect(row.querySelector(`${CAPSULE}, .conn-remove`)).toBeNull();
    // Money's one tone on the glyph, never the brand red (it cannot be tapped) and never the picture's blue.
    expect(row.querySelector(".gm-slot")).toHaveClass("cat-fg-green");
    expect(within(row.closest(".task-swipe") as HTMLElement).getByRole("button", { name: "Delete Corner Store" })).toHaveClass("task-del");
    fireEvent.click(row);
    expect(await screen.findByText("Delete Receipt")).toBeInTheDocument();
    expect(strays(container)).toEqual([]);
  });
});

describe("a sheet holds its actions as rows, not as capsules inside a match row", () => {
  it("a matched payment's sheet offers Unmatch Receipt as an action row", async () => {
    mount("tra-sheet", async (h) => {
      const txId = (await h.tracker.saveTx(null, tx({ merchant: "Stop & Shop" })))!;
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: day(8), category: "Groceries" }, "manual", day(8));
      if (!r.ok) throw new Error("seed");
      const a = await h.ledger.approveReceiptMatch(r.id, txId);
      if (!a.ok) throw new Error("link");
    });
    await tab("Activity");
    fireEvent.click((await screen.findByText("Stop & Shop", { selector: ".task-name" })).closest(".task-row")!);
    await screen.findByText("Edit Transaction");
    expect(screen.getByRole("button", { name: "Unmatch Receipt" })).toBeInTheDocument();
    expect(document.querySelector(".xs .pill-act, .xs .quiet-action")).toBeNull();
  });
});
