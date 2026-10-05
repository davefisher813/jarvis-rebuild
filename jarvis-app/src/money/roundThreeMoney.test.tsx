// @vitest-environment jsdom
// FIX ROUND 3 ON MONEY (Dave 2026-10-05: "Everything should look PERFECT"). Each case renders the REAL component and asserts
// one property the round-2 screenshot review found wrong; each fails against the code as it stood before the fix.
import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useGoals, useLedger, useMoney, useProfile, useTasks, useTracker } from "../data/NotesProvider";
import type { MoneyService } from "./MoneyService";
import MoneyFlow from "./MoneyFlow";
import TrackerScreen from "./screens/TrackerScreen";
import type { LedgerService } from "./ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import type { GoalService } from "../life/GoalService";
import type { ProfileService } from "../profile/ProfileService";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { monthDay } from "./bills";
import { thisMonth, type TrackerTxData } from "./tracker";
import { resetToasts } from "../shared/toast";

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
const mount = (user: string, seed: (s: Svc) => Promise<void>, props: Parameters<typeof MoneyFlow>[0] = {}) =>
  render(<NotesProvider userId={user}><Seed seed={seed}><MoneyFlow {...props} /></Seed></NotesProvider>);

const addBill = async (l: LedgerService, i: Parameters<LedgerService["addBill"]>[0]) => {
  const r = await l.addBill(i);
  if (!r.ok) throw new Error(r.errors.join());
  return r.id;
};
const rowOf = (name: string) => screen.getByText(name, { selector: ".task-name" }).closest(".task-row") as HTMLElement;

// ---------------------------------------------------------------------------
// Bills: one date grammar, the dot the CSS's
// ---------------------------------------------------------------------------
describe("every bill says when in one grammar: a state fact in its key colour, then a date fact", () => {
  const seedBills = async ({ ledger }: Svc) => {
    await addBill(ledger, { vendor: "Rent", amount: 2200, dueDate: day(2) });
    await addBill(ledger, { vendor: "Internet", amount: 89, dueDate: day(4), autopay: true });
    await addBill(ledger, { vendor: "Car Insurance", amount: 148, dueDate: day(12) });
  };

  it("each line is a .facts of separate .fact spans, never an r-goal run, and no typed dot", async () => {
    mount("r3-grammar", seedBills);
    await screen.findByText("Rent", { selector: ".task-name" });
    for (const name of ["Rent", "Internet", "Car Insurance"]) {
      const row = rowOf(name);
      const facts = row.querySelector(".task-title .facts") as HTMLElement;
      expect(facts, name + " has a facts line").not.toBeNull();
      expect(row.querySelector(".r-goal"), name + " draws no r-goal run (it is not a .fact, so no dot is drawn)").toBeNull();
      for (const f of facts.querySelectorAll(".fact")) expect(f.textContent, name).not.toMatch(/[·•]/);
      // Every direct child is a fact: the CSS draws the dot between neighbours, which needs two .fact siblings.
      for (const c of facts.children) expect(c.classList.contains("fact"), name).toBe(true);
    }
  });

  it("Rent: a due state in amber, then its date; Internet: its own words in the one grey, then its day as a date; Car Insurance: the date alone", async () => {
    mount("r3-grammar2", seedBills);
    await screen.findByText("Rent", { selector: ".task-name" });
    const rent = rowOf("Rent").querySelectorAll(".task-title .facts > .fact");
    expect([...rent].map((f) => f.textContent)).toEqual(["Due in 2 Days", monthDay(day(2))]);
    expect(rent[0]).toHaveClass("warn");
    expect(rent[1]).toHaveClass("date");

    const net = rowOf("Internet").querySelectorAll(".task-title .facts > .fact");
    expect([...net].map((f) => f.textContent)).toEqual(["Set to Autopay", expect.any(String)]);
    expect(net[0]).not.toHaveClass("warn", "red", "good", "date");
    expect(net[1]).toHaveClass("date");

    const car = rowOf("Car Insurance").querySelectorAll(".task-title .facts > .fact");
    expect([...car].map((f) => f.textContent)).toEqual([monthDay(day(12))]);
    expect(car[0]).toHaveClass("date");
    // A due date is a date, never "Due Oct 17" in grey caps beside rows that say it another way.
    expect(rowOf("Car Insurance").textContent).not.toMatch(/Due/);
  });

  it("the Bills card's amounts share one shape: with cents on any bill, cents on every bill", async () => {
    mount("r3-cents", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Rent", amount: 2200, dueDate: day(2) });
      await addBill(ledger, { vendor: "Phone", amount: 89.5, dueDate: day(3) });
    });
    await screen.findByText("Rent", { selector: ".task-name" });
    expect(within(rowOf("Rent")).getByText("$2,200.00")).toBeInTheDocument();
    expect(within(rowOf("Phone")).getByText("$89.50")).toBeInTheDocument();
  });

  it("an autopay bill's glyph is not green: green means paid, and the glyph sits where the checkbox does", async () => {
    mount("r3-autopay", seedBills);
    await screen.findByText("Internet", { selector: ".task-name" });
    const slot = rowOf("Internet").querySelector(".task-check-tap .gm-slot") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.className).not.toMatch(/cat-fg-(green|red|brand)/);
  });
});

describe("Set Up Payday is the Bills head's capsule, not a bare row inside the card", () => {
  it("with bills and no payday it sits in the head beside Add Bill, and no row of the card says it", async () => {
    mount("r3-payday", async ({ ledger }) => {
      await addBill(ledger, { vendor: "Rent", amount: 2200, dueDate: day(2) });
    });
    await screen.findByText("Rent", { selector: ".task-name" });
    const head = screen.getByText("Bills", { selector: ".t" }).closest(".sh2") as HTMLElement;
    expect(within(head).getByRole("button", { name: "Set Up Payday" })).toBeInTheDocument();
    expect(within(head).getByRole("button", { name: "Add Bill" })).toBeInTheDocument();
    // At most two capsules in a head (D1).
    expect(head.querySelectorAll(".pill-action").length).toBeLessThanOrEqual(2);
    for (const row of document.querySelectorAll(".task-row")) expect(row.textContent).not.toMatch(/Set Up Payday/);
    expect(document.querySelector(".card")?.textContent ?? "").not.toMatch(/Set Up Payday/);
    // And it still opens the payday sheet.
    fireEvent.click(within(head).getByRole("button", { name: "Set Up Payday" }));
    expect(await screen.findByText("Paycheck")).toBeInTheDocument();
  });

  it("once a payday is set the capsule is gone and the payday row's title shares the bills' left edge (a leading slot)", async () => {
    mount("r3-payday2", async ({ ledger, profile }) => {
      await addBill(ledger, { vendor: "Rent", amount: 2200, dueDate: day(2) });
      await profile.save({ payday: { amount: 3000, next: day(5), freq: "biweekly" } });
    });
    await screen.findByText("Rent", { selector: ".task-name" });
    const head = screen.getByText("Bills", { selector: ".t" }).closest(".sh2") as HTMLElement;
    expect(within(head).queryByRole("button", { name: "Set Up Payday" })).toBeNull();
    const anchor = screen.getByText(/^Between Now and/).closest(".task-row") as HTMLElement;
    expect(anchor.querySelector(".task-check-tap")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
describe("the Accounts column is one shape, with a true minus and even rows", () => {
  const seedAccts = async ({ money }: Svc) => {
    await money.create({ name: "Brokerage", balance: 32540.75, kind: "investment" });
    await money.create({ name: "Checking", balance: 4820.5, kind: "cash" });
    await money.create({ name: "Credit Card", balance: 1240.3, kind: "credit" });
    await money.create({ name: "Savings", balance: 18230, kind: "savings" });
  };

  it("a whole-dollar balance beside balances with cents shows its cents, and the debt wears U+2212, not a hyphen", async () => {
    mount("r3-accts", seedAccts);
    await screen.findByText("Total Balance");
    expect(within(rowOf("Savings")).getByText("$18,230.00")).toBeInTheDocument();
    const debt = within(rowOf("Credit Card")).getByText("−$1,240.30");
    expect(debt.textContent).not.toContain("-");
    // The total stands in the same shape.
    expect(document.querySelector(".money-hero-total")?.textContent).toMatch(/\.\d\d$/);
  });

  it("all whole dollars stay whole: nothing gains a .00 it never had", async () => {
    mount("r3-accts2", async ({ money }) => {
      await money.create({ name: "Checking", balance: 4800, kind: "cash" });
      await money.create({ name: "Savings", balance: 18000, kind: "savings" });
    });
    await screen.findByText("Total Balance");
    expect(within(rowOf("Savings")).getByText("$18,000")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Saving Toward, Also Tagged, the bar
// ---------------------------------------------------------------------------
describe("a savings goal on a goal list wears the one goalTone every goal list wears", () => {
  it("its area's colour through goalTone (Dave 2026-08-31), never a purple type glyph or a hardcoded colour", async () => {
    mount("r3-goal", async ({ ledger, goals }) => {
      await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(9) });
      await goals.create({ title: "build a six-month runway", state: "on_track", moneyTarget: 2400000, tags: ["home"] });
    });
    const row = await waitFor(() => rowOf("Build a Six-Month Runway"));
    const slot = row.querySelector(".task-check-tap .gm-slot") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.className).toMatch(/cat-fg-/);
    expect(slot.className).not.toMatch(/cat-fg-purple/);
  });
});

describe("Also Tagged Money states a due day on the row's own line, worded Due, with nothing at the right edge", () => {
  function SeededTagged() {
    const tasks = useTasks();
    const cats = useCategories();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      void (async () => {
        const money = await cats.create("Money", "yellow");
        await tasks.createTask("Pay Ticket", { category: money!, due: T });
        await tasks.createTask("Confirm Fee", { category: money!, due: day(1) });
        await tasks.createTask("Order Gear", { category: money!, due: day(3) });
        setReady(true);
      })();
    }, [tasks, cats]);
    return ready ? <MoneyFlow /> : null;
  }

  it("today and tomorrow are amber facts, a later day is a small-caps date fact, and no row has a trailing urgency word", async () => {
    render(<NotesProvider userId="r3-tagged"><SeededTagged /></NotesProvider>);
    await screen.findByText("Also Tagged Money");
    const today = rowOf("Pay Ticket");
    const tomorrow = rowOf("Confirm Fee");
    const later = rowOf("Order Gear");
    expect(within(today).getByText("Due Today")).toHaveClass("fact", "warn");
    expect(within(tomorrow).getByText("Due Tomorrow")).toHaveClass("fact", "warn");
    const laterFact = later.querySelector(".r-k .fact.date") as HTMLElement;
    expect(laterFact.textContent).toMatch(/^Due [A-Z][a-z]{2}( \d+)?$/);
    expect(laterFact).not.toHaveClass("warn");
    // The same facts sit on the line under the title: nothing is pushed to the right edge, so the title has the full width.
    for (const r of [today, tomorrow, later]) expect(r.querySelector(".urgency")).toBeNull();
  });
});

describe("the Money bar says where it goes back to, and carries no unlabelled glyph", () => {
  it("a back link to More when opened from there, no paperclip, and Add Receipt is the Receipts head's capsule", async () => {
    const back = vi.fn();
    mount("r3-bar", async ({ ledger }) => { await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(9) }); }, { onBack: back });
    await screen.findByText("Water", { selector: ".task-name" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".pagebar-acts")?.children.length).toBe(0);
    expect(screen.queryByLabelText("Add a Receipt")).toBeNull();
    const head = screen.getByText("Receipts", { selector: ".t" }).closest(".sh2") as HTMLElement;
    expect(within(head).getByRole("button", { name: "Add Receipt" })).toHaveClass("pill-action");
  });

  it("without a way back (Money pinned as a tab) there is no back link", async () => {
    mount("r3-bar2", async ({ ledger }) => { await addBill(ledger, { vendor: "Water", amount: 40, dueDate: day(9) }); }, { onBack: () => {}, inTabBar: true });
    await screen.findByText("Water", { selector: ".task-name" });
    expect(document.querySelector(".nav-back")).toBeNull();
  });
});

describe("the Tracker row's net is a white number when more went out", () => {
  const MONTH = thisMonth();
  const tx = (over: Partial<TrackerTxData>): TrackerTxData => ({
    date: `${MONTH}-03`, month: MONTH, merchant: "Stop & Shop", name: "STOP & SHOP", amountCents: 4712, category: "Groceries", account: "", ...over,
  });
  it("with spending in the month, the row's fact reads the amount in white and More Out in the line's grey", async () => {
    function Harness() {
      const trk = useTracker();
      const [ready, setReady] = useState(false);
      useEffect(() => { void (async () => { await trk.saveTx(null, tx({})); setReady(true); })(); }, [trk]);
      return ready ? <MoneyFlow /> : null;
    }
    render(<NotesProvider userId="r3-trk2"><Harness /></NotesProvider>);
    const more = await screen.findByText(/More Out/);
    expect(more).toHaveClass("fact");
    expect(more).not.toHaveClass("red");
    expect(more.querySelector("b")).toHaveTextContent("$47.12");
  });
});

// ---------------------------------------------------------------------------
// The Tracker
// ---------------------------------------------------------------------------
describe("the Tracker's top merchants wrap to a second line before they truncate", () => {
  const MONTH = thisMonth();
  const mtx = (over: Partial<TrackerTxData>): TrackerTxData => ({
    date: `${MONTH}-03`, month: MONTH, merchant: "Stop & Shop", name: "STOP & SHOP", amountCents: 4712, category: "Groceries", account: "", ...over,
  });
  function TrackerHarness() {
    const tracker = useTracker();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      void (async () => {
        await tracker.saveTx(null, mtx({ merchant: "E. Gaynor Brennan Municipal Golf Course", name: "E GAYNOR BRENNAN MUNI", amountCents: 13399 }));
        setReady(true);
      })();
    }, [tracker]);
    return ready ? <TrackerScreen onBack={() => {}} /> : null;
  }

  it("a merchant name wears the wrapping name class, so no nowrap ellipsis cuts it", async () => {
    render(<NotesProvider userId="r3-merch"><TrackerHarness /></NotesProvider>);
    const name = await screen.findByText("E. Gaynor Brennan Municipal Golf Course", { selector: ".conn-name" });
    expect(name).toHaveClass("truncate");
    expect(name.textContent).toBe("E. Gaynor Brennan Municipal Golf Course");
  });

  it("Net is white with a true minus when more went out, never red", async () => {
    render(<NotesProvider userId="r3-net"><TrackerHarness /></NotesProvider>);
    await screen.findByText("Net");
    const net = screen.getByText("Net").nextElementSibling as HTMLElement;
    await waitFor(() => expect(net).toHaveTextContent("−$133.99"));
    expect(net).not.toHaveClass("red");
    expect(net).not.toHaveClass("fact");
  });
});
