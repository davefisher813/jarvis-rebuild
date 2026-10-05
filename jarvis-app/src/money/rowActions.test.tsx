// @vitest-environment jsdom
// THE ROW-ACTION MODEL ON MONEY (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). Clean rows, no pills
// anywhere: a tap opens the row's sheet, the swipe left is the row's one quickest verb, the swipe right completes, the
// long press is the menu, and a row whose moment has come quietly shows its verb as text. Section-level actions (Add
// Account, Add Bill, Set Money Aside) sit on their section's head, never inside a card. These render the real screens.
import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotesProvider, useGoals, useLedger, useMoney, useProfile, useTasks } from "../data/NotesProvider";
import type { MoneyService } from "./MoneyService";
import MoneyFlow from "./MoneyFlow";
import type { LedgerService } from "./ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import type { GoalService } from "../life/GoalService";
import type { ProfileService } from "../profile/ProfileService";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { resetToasts } from "../shared/toast";
import { capsulesInCards, loneActionBoxes } from "../laws/catalogCheck";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetToasts(); localStorage.clear(); });

const T = todayISO();
const day = (n: number) => addDays(T, n);

interface Svc { ledger: LedgerService; tasks: TasksService; goals: GoalService; profile: ProfileService; money: MoneyService }
function Seed({ seed, children }: { seed: (s: Svc) => Promise<void>; children: ReactNode }) {
  const ledger = useLedger();
  const tasks = useTasks();
  const goals = useGoals();
  const profile = useProfile();
  const money = useMoney();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void seed({ ledger, tasks, goals, profile, money }).then(() => setReady(true));
  }, [ledger, tasks, goals, profile, money, seed]);
  return ready ? <>{children}</> : null;
}
const mount = (user: string, seed: (s: Svc) => Promise<void>) =>
  render(<NotesProvider userId={user}><Seed seed={seed}><MoneyFlow /></Seed></NotesProvider>);

const addBill = async (l: LedgerService, i: Parameters<LedgerService["addBill"]>[0]) => {
  const r = await l.addBill(i);
  if (!r.ok) throw new Error(r.errors.join());
  return r.id;
};
const rowOf = (name: string) => screen.getByText(name, { selector: ".task-name" }).closest(".task-row") as HTMLElement;
const swipeOf = (name: string) => rowOf(name).closest(".task-swipe") as HTMLElement;
const CAPSULE = ".pill-act, .row-act, .btn-sm, .quiet-action";

describe("a bill row: one verb per state, no pill", () => {
  it("an unpaid bill swipes left to Mark Paid and right to Paid, with Delete behind it; autopay and paid have neither verb", async () => {
    mount("ra-bills", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
      await addBill(ledger, { vendor: "Rent", amount: 1850, dueDate: day(5), autopay: true });
      const p = await addBill(ledger, { vendor: "Gas", amount: 60, dueDate: day(-1) });
      await ledger.markBillPaidByUser(p, day(-1));
    });
    await screen.findByText("Water", { selector: ".task-name" });
    // Unpaid: the verb is the tray's first button, the right swipe is the Paid rail, and Delete follows the verb.
    const water = swipeOf("Water");
    expect(within(water).getByRole("button", { name: "Mark Paid Water" })).toHaveClass("task-verb");
    expect(within(water).getByRole("button", { name: "Delete Water" })).toHaveClass("task-del");
    expect(water.querySelector(".task-done-rail")).not.toBeNull();
    // Autopay: the app cannot know a payment cleared (the money law), so no verb and no rail; Delete stays.
    const rent = swipeOf("Rent");
    expect(within(rent).queryByRole("button", { name: /^Mark Paid/ })).toBeNull();
    expect(rent.querySelector(".task-done-rail")).toBeNull();
    expect(within(rent).getByRole("button", { name: "Delete Rent" })).toBeInTheDocument();
    // Paid: nothing left to mark.
    const gas = swipeOf("Gas");
    expect(within(gas).queryByRole("button", { name: /^Mark Paid/ })).toBeNull();
    expect(gas.querySelector(".task-done-rail")).toBeNull();
  });

  it("no bill row wears a pill, a capsule or a Pay link: the pay link is in the long-press menu", async () => {
    const { container } = mount("ra-nopill", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5), payUrl: "https://pay.example.com" });
    });
    const row = await waitFor(() => rowOf("Water"));
    expect(row.querySelector(CAPSULE)).toBeNull();
    expect(row.querySelector("a, .bill-pay")).toBeNull();
    fireEvent.contextMenu(row);
    // The same actions again, for the person who knows to hold: the verb first, the pay link, Edit, Delete.
    const sheet = await screen.findByText("Water", { selector: ".eyebrow" });
    const labels = [...sheet.closest(".card")!.querySelectorAll(".action-sheet button")].map((b) => b.textContent);
    expect(labels).toEqual(["Mark Paid", "Pay", "Edit", "Delete"]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(capsulesInCards(container).filter((c) => !c.startsWith("Add"))).toEqual([]);
  });

  it("a bill whose moment has come (late, or due today) quietly shows Mark Paid as text; a future bill stays clean", async () => {
    mount("ra-ctx", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Late Co", amount: 60, dueDate: day(-3) });
      await addBill(ledger, { vendor: "Today Co", amount: 20, dueDate: day(0) });
      await addBill(ledger, { vendor: "Later Co", amount: 30, dueDate: day(9) });
      await addBill(ledger, { vendor: "Auto Co", amount: 15, dueDate: day(-2), autopay: true });
    });
    await screen.findByText("Late Co", { selector: ".task-name" });
    const ctx = (name: string) => rowOf(name).querySelector(".row-ctx");
    expect(ctx("Late Co")).toHaveTextContent("Mark Paid");
    expect(ctx("Today Co")).toHaveTextContent("Mark Paid");
    expect(ctx("Later Co")).toBeNull();
    // Autopay: nothing for a word to claim, however late.
    expect(ctx("Auto Co")).toBeNull();
    // Text only, in the key colour: not a capsule, and the SAME verb as the swipe.
    expect(ctx("Late Co")!.matches(CAPSULE)).toBe(false);
    expect(within(swipeOf("Late Co")).getAllByRole("button", { name: "Mark Paid Late Co" }).some((b) => b.classList.contains("task-verb"))).toBe(true);
    // Tapping it does the verb (the same one-tap-or-confirm door every Mark Paid shares) and does not open the bill.
    fireEvent.click(ctx("Late Co")!);
    expect(await screen.findByLabelText("Paid on")).toBeInTheDocument();
    expect(screen.queryByText("Delete Bill")).toBeNull();
  });

  it("a legacy bill's sheet holds its verb too: Mark Paid is a row of Edit Bill", async () => {
    mount("ra-legacy", async ({ tasks }) => {
      await tasks.recreateFrom({ text: "Rent", category: "", done: false, due: day(4), bill: { amount: 1850 } });
    });
    fireEvent.click(await screen.findByText("Rent", { selector: ".task-name" }));
    await screen.findByText("Edit Bill");
    expect(screen.getByRole("button", { name: "Mark Paid" })).toBeInTheDocument();
  });
});

describe("a section's action is its head's capsule, never a row or a card", () => {
  it("Add Account, Add Bill and Set Money Aside each sit in their own head", async () => {
    const { container } = mount("ra-heads", async ({ ledger, profile }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
      await profile.save({ payday: { amount: 2000, next: day(6), freq: "biweekly" } });
    });
    await screen.findByText("Water", { selector: ".task-name" });
    const head = (title: string) => [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === title) as HTMLElement;
    expect(within(head("Accounts")).getByRole("button", { name: "Add Account" })).toHaveClass("pill-action");
    expect(within(head("Bills")).getByRole("button", { name: "Add Bill" })).toHaveClass("pill-action");
    expect(within(head("Set Aside")).getByRole("button", { name: "Set Money Aside" })).toHaveClass("pill-action");
    // Nothing of the old rows survives: no capsule at the foot of any card, and none anywhere in a card or row.
    expect(container.querySelector(".row-act")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
    expect(loneActionBoxes(container)).toEqual([]);
  });

  it("with no bills and nothing set aside, Bills and Set Aside are their heads and capsules only: no empty plate", async () => {
    const { container } = mount("ra-lone", async ({ money, profile }) => {
      await money.create({ name: "Checking", balance: 100, kind: "cash", asOf: T });
      await profile.save({ payday: { amount: 2000, next: day(6), freq: "biweekly" } });
    });
    await screen.findByText("Checking", { selector: ".task-name" });
    const head = (title: string) => [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === title) as HTMLElement;
    expect(within(head("Bills")).getByRole("button", { name: "Add Bill" })).toBeInTheDocument();
    expect(within(head("Set Aside")).getByRole("button", { name: "Set Money Aside" })).toBeInTheDocument();
    // The head is followed by no card: the capsule stands by itself (rule 12).
    expect(head("Bills").nextElementSibling?.querySelector(".card") ?? null).toBeNull();
    expect(head("Set Aside").nextElementSibling?.querySelector(".card") ?? null).toBeNull();
    expect(loneActionBoxes(container)).toEqual([]);
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("Add Bill opens the new bill sheet and Set Money Aside the set-aside sheet", async () => {
    const { container } = mount("ra-open", async ({ ledger, profile }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
      await profile.save({ payday: { amount: 2000, next: day(6), freq: "biweekly" } });
    });
    await screen.findByText("Water", { selector: ".task-name" });
    const accounts = [...container.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Accounts") as HTMLElement;
    fireEvent.click(within(accounts).getByRole("button", { name: "Add Account" }));
    expect(await screen.findByText("New Account")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Add Bill" }));
    expect(await screen.findByText("New Bill")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Set Money Aside" }));
    expect(await screen.findByPlaceholderText("What For")).toBeInTheDocument();
  });
});

describe("Set Aside rows: his words in Title Case, a tap edits, a swipe removes", () => {
  it("a set-aside typed in lowercase is shown in Title Case and stored as typed; the row has no pill and no trash button", async () => {
    const { container } = mount("ra-env", async ({ ledger, profile }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
      await profile.save({ payday: { amount: 2000, next: day(6), freq: "biweekly" }, envelopes: [{ id: "e1", name: "emergency fund", amount: 300 }] });
    });
    const row = await waitFor(() => rowOf("Emergency Fund"));
    expect(row.querySelector(CAPSULE)).toBeNull();
    expect(row.querySelector(".conn-remove")).toBeNull();
    expect(within(swipeOf("Emergency Fund")).getByRole("button", { name: "Remove Emergency Fund" })).toHaveClass("task-del");
    // The tap is the sheet it was made in, filled with what he typed.
    fireEvent.click(row);
    expect((await screen.findByLabelText("What for") as HTMLInputElement).value).toBe("emergency fund");
    expect(screen.getByText("Remove Set Aside")).toBeInTheDocument();
    expect(capsulesInCards(container)).toEqual([]);
  });
});

describe("Saving Toward: a clean goal row whose verb is Add", () => {
  it("the row has no pill; its tap and its swipe open the amount sheet, and Add lands the money", async () => {
    mount("ra-save", async ({ ledger, goals }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
      await goals.create({ title: "raise 100k for bridge", state: "on_track", moneyTarget: 100000 });
    });
    const row = await waitFor(() => rowOf("Raise 100k for Bridge"));
    expect(row.querySelector(CAPSULE)).toBeNull();
    // Nothing to complete here, so no right swipe; the verb is Add.
    expect(swipeOf("Raise 100k for Bridge").querySelector(".task-done-rail")).toBeNull();
    expect(within(swipeOf("Raise 100k for Bridge")).getByRole("button", { name: "Add Raise 100k for Bridge" })).toHaveClass("task-verb");
    fireEvent.click(row);
    expect(await screen.findByText("Add Savings")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "250" } });
    fireEvent.click(screen.getByText("Add", { selector: ".sheet-bar-save" }));
    await waitFor(() => expect(screen.queryByText("Add Savings")).toBeNull());
    expect(await screen.findByText(/\$250/)).toBeInTheDocument();
  });
});

describe("an account row: a tap opens its sheet, a swipe deletes, and the name is in Title Case", () => {
  it("shows a lowercase account in Title Case and holds Delete behind the swipe", async () => {
    const { container } = mount("ra-acct", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(5) });
    });
    await screen.findByText("Water", { selector: ".task-name" });
    fireEvent.click(screen.getByRole("button", { name: "Add Account" }));
    fireEvent.change(await screen.findByLabelText("Account name"), { target: { value: "everyday checking" } });
    fireEvent.change(screen.getByLabelText("Balance in dollars"), { target: { value: "1200" } });
    fireEvent.click(screen.getByText("Save"));
    const row = await waitFor(() => rowOf("Everyday Checking"));
    expect(row.querySelector(CAPSULE)).toBeNull();
    expect(within(swipeOf("Everyday Checking")).getByRole("button", { name: "Delete Everyday Checking" })).toBeInTheDocument();
    expect(capsulesInCards(container)).toEqual([]);
  });
});

describe("Money's type icon", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/components.css"), "utf8");

  it("an autopay bill's glyph is Money's green, and light takes the glyph set's twin, never the text ink", async () => {
    const { container } = mount("ra-icon", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Internet", amount: 89, autopay: true });
    });
    await screen.findByText("Internet", { selector: ".task-name" });
    const slot = container.querySelector(".task-check-tap .gm-slot") as HTMLElement;
    expect(slot).toHaveClass("cat-fg-green");
    expect(slot).not.toHaveClass("cat-fg-blue", "cat-fg-brand");
    expect(css).toMatch(/\[data-theme="light"\] \.gm-slot\.cat-fg-green \{ color: var\(--cat-ic-green\); \}/);
    expect(css).toMatch(/--cat-ic-green: #[0-9A-Fa-f]{6};/);
  });
});
