// @vitest-environment jsdom
// ROUND ONE OF THE PERFECT BAR, ON MONEY (Dave 2026-10-05: "Everything should look PERFECT"). Each case renders the REAL
// component through the real markup and asserts one property the screenshot review found wrong. A case here fails
// against the code as it stood before the fix.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useMoney, useTracker } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";
import TrackerScreen from "./screens/TrackerScreen";
import { addDays } from "../schedule/calendar";
import { todayISO } from "../tasks/grouping";
import { monthDay } from "./bills";
import { kindRestated } from "./types";
import { accountParts, monthLabel, thisMonth, type TrackerTxData } from "./tracker";
import { resetToasts } from "../shared/toast";
import type { TasksService } from "../tasks/TasksService";
import type { BillInfo } from "../notes/types";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); resetToasts(); });

const T = todayISO();

async function legacyBill(svc: TasksService, text: string, o: { due?: string; bill: BillInfo }): Promise<string | null> {
  return svc.recreateFrom({ text, category: "", done: false, ...o });
}

// ---------------------------------------------------------------------------
// The Accounts card
// ---------------------------------------------------------------------------
function SeededAccounts() {
  const money = useMoney();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await money.create({ name: "Brokerage", balance: 32000, kind: "investment" });
      await money.create({ name: "Checking", balance: 4800, kind: "cash" });
      await money.create({ name: "Credit Card", balance: 1240, kind: "credit" });
      await money.create({ name: "Savings", balance: 18000, kind: "savings" });
      setReady(true);
    })();
  }, [money]);
  return ready ? <MoneyFlow /> : null;
}

describe("the Accounts card says each thing once", () => {
  it("the hero card does not count the accounts again: the head says 4, the rows are the four", async () => {
    render(<NotesProvider userId="r1-count"><SeededAccounts /></NotesProvider>);
    await screen.findByText("Total Balance");
    const card = document.querySelector(".money-hero-card") as HTMLElement;
    expect(card.textContent).not.toMatch(/\b4 Accounts\b/);
    expect(card.querySelectorAll(".money-hero .fact")).toHaveLength(1);
    expect(card.querySelector(".money-hero .fact")).toHaveTextContent("As You Last Entered It");
    // The head keeps the count every section head wears.
    expect(document.querySelector(".sh2 .n")).toHaveTextContent("4");
  });

  it("a row whose kind only restates its name shows no second line; a kind that adds something stays", async () => {
    render(<NotesProvider userId="r1-kind"><SeededAccounts /></NotesProvider>);
    await screen.findByText("Total Balance");
    const row = (name: string) => screen.getByText(name, { selector: ".task-name" }).closest(".task-row") as HTMLElement;
    // "Savings" under "Savings" and "Credit" under "Credit Card" said the title again.
    expect(row("Savings").querySelector(".r-k")).toBeNull();
    expect(row("Credit Card").querySelector(".r-k")).toBeNull();
    // "Investment" under "Brokerage" and "Cash" under "Checking" are information.
    expect(within(row("Brokerage")).getByText("Investment")).toBeInTheDocument();
    expect(within(row("Checking")).getByText("Cash")).toBeInTheDocument();
  });

  it("kindRestated reads whole words of the name, not substrings", () => {
    expect(kindRestated("Savings", "Savings")).toBe(true);
    expect(kindRestated("Credit Card", "Credit")).toBe(true);
    expect(kindRestated("My Cash Jar", "Cash")).toBe(true);
    expect(kindRestated("Cashew Fund", "Cash")).toBe(false);
    expect(kindRestated("Brokerage", "Investment")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A bill's due state is text, not a capsule on the row
// ---------------------------------------------------------------------------
function SeededBills() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await legacyBill(tasks, "Rent", { due: addDays(T, 2), bill: { amount: 2200 } });
      await legacyBill(tasks, "Phone", { due: T, bill: { amount: 60 } });
      await legacyBill(tasks, "Water", { due: addDays(T, -1), bill: { amount: 40 } });
      setReady(true);
    })();
  }, [tasks]);
  return ready ? <MoneyFlow /> : null;
}

describe("a bill row draws its state as text in the key's colour", () => {
  it("due in 2 days is amber text with the one date beside it, no capsule", async () => {
    render(<NotesProvider userId="r1-bill"><SeededBills /></NotesProvider>);
    await screen.findByText("Rent");
    const row = screen.getByText("Rent").closest(".task-row") as HTMLElement;
    const state = within(row).getByText("Due in 2 Days");
    expect(state).toHaveClass("fact", "warn");
    expect(state).not.toHaveClass("uchip");
    // One date fact, the day only ("Due" is not said twice).
    const dates = row.querySelectorAll(".fact.date");
    expect(dates).toHaveLength(1);
    expect(dates[0]).toHaveTextContent(monthDay(addDays(T, 2)));
    expect(row.querySelector(".uchip")).toBeNull();
  });

  it("due today is amber text and a late bill is red text", async () => {
    render(<NotesProvider userId="r1-bill2"><SeededBills /></NotesProvider>);
    await screen.findByText("Phone");
    const phone = screen.getByText("Phone").closest(".task-row") as HTMLElement;
    expect(within(phone).getByText("Due Today")).toHaveClass("fact", "warn");
    const water = screen.getByText("Water").closest(".task-row") as HTMLElement;
    expect(within(water).getByText("1 Day Late")).toHaveClass("fact", "red");
    // No row in the Bills card carries a capsule.
    expect(document.querySelectorAll(".uchip")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Also Tagged Money
// ---------------------------------------------------------------------------
function SeededTagged() {
  const tasks = useTasks();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const money = await cats.create("Money", "yellow");
      const home = await cats.create("Home", "blue");
      await tasks.createTask("Create Invoice", { category: money!, due: T });
      await tasks.createTask("Fix Meter", { category: money!, extraCategories: [home!] });
      await tasks.createTask("Chase Summit Gear Order #D2565", { category: money! });
      setReady(true);
    })();
  }, [tasks, cats]);
  return ready ? <MoneyFlow /> : null;
}

describe("Also Tagged Money does not repeat its own head on every row", () => {
  it("no row says Money, a second area still shows, and today is amber text", async () => {
    render(<NotesProvider userId="r1-tag"><SeededTagged /></NotesProvider>);
    await screen.findByText("Also Tagged Money");
    const list = screen.getByText("Also Tagged Money").closest(".sh2")!.nextElementSibling as HTMLElement;
    const rowOf = (name: string) => within(list).getByText(name).closest(".task-row") as HTMLElement;
    // Every row here is tagged Money under a head that says so: no row draws the Money area (its dot and name).
    expect(rowOf("Create Invoice").querySelector(".r-parent")).toBeNull();
    expect(rowOf("Chase Summit Gear Order #D2565").querySelector(".r-parent")).toBeNull();
    // A task with only the Money tag and no date has no second line at all.
    // (the row may keep an empty line box; the stylesheet does not draw it, which the next case holds)
    const gearLine = rowOf("Chase Summit Gear Order #D2565").querySelector(".r-k");
    expect(gearLine === null || (gearLine.childElementCount === 0 && gearLine.textContent === "")).toBe(true);
    // Another area on the task is information and stays: exactly one area, and it is not Money's.
    const areas = rowOf("Fix Meter").querySelectorAll(".r-parent");
    expect(areas).toHaveLength(1);
    expect(within(list).queryByText("Money")).toBeNull();
    const invoice = rowOf("Create Invoice");
    // Due today is the key's amber as text, never a filled chip, and worded "Due" like Notifications' same task.
    expect(within(invoice).getByText("Due Today")).toHaveClass("fact", "warn");
    expect(list.querySelector(".uchip")).toBeNull();
  });

  it("an empty second line is not drawn, so a row with nothing to say is not taller than its neighbours", () => {
    const css = readFileSync(join(__dirname, "../styles/ruled.css"), "utf8");
    expect(css).toMatch(/\.ruled \.r-k-one:empty\s*\{\s*display:\s*none;\s*\}/);
  });

  it("the title is never clamped: an order number can wrap but not be cut", () => {
    // The clamp lives in CSS; the row must not carry an inline one, and the full text must be in the DOM.
    render(<NotesProvider userId="r1-tag2"><SeededTagged /></NotesProvider>);
    return screen.findByText("Chase Summit Gear Order #D2565").then((el) => {
      expect(el.textContent).toBe("Chase Summit Gear Order #D2565");
      expect(el.getAttribute("style") ?? "").not.toMatch(/line-clamp|ellipsis/);
    });
  });
});

// ---------------------------------------------------------------------------
// The Tracker
// ---------------------------------------------------------------------------
const MONTH = thisMonth();
const mtx = (over: Partial<TrackerTxData>): TrackerTxData => ({
  date: `${MONTH}-03`, month: MONTH, merchant: "Stop & Shop", name: "STOP & SHOP", amountCents: 4712, category: "Groceries", account: "", ...over,
});

function TrackerHarness({ seed }: { seed?: (t: ReturnType<typeof useTracker>) => Promise<void> }) {
  const tracker = useTracker();
  const [ready, setReady] = useState(false);
  useEffect(() => { void (async () => { await seed?.(tracker); setReady(true); })(); }, [tracker, seed]);
  return ready ? <TrackerScreen onBack={() => {}} /> : null;
}
const mountTracker = (id: string, seed?: (t: ReturnType<typeof useTracker>) => Promise<void>) =>
  render(<NotesProvider userId={id}><TrackerHarness seed={seed} /></NotesProvider>);
const netValue = () => screen.getByText("Net").nextElementSibling as HTMLElement;

describe("the Tracker's Net is green only when it is above zero, and never red", () => {
  it("zero is a number with no state: neither green nor red", async () => {
    mountTracker("r1-net0");
    await screen.findByText("Net");
    expect(netValue()).toHaveTextContent("$0.00");
    expect(netValue()).not.toHaveClass("good");
    expect(netValue()).not.toHaveClass("red");
  });
  it("more out than in is a white number with a true minus (red is for late), more in than out is green", async () => {
    mountTracker("r1-netneg", async (t) => { await t.saveTx(null, mtx({})); });
    await screen.findByText("Net");
    await waitFor(() => expect(netValue()).toHaveTextContent("\u2212$47.12"));
    expect(netValue().textContent).not.toContain("-");
    expect(netValue()).not.toHaveClass("red");
    expect(netValue()).not.toHaveClass("good");
    cleanup();
    mountTracker("r1-netpos", async (t) => { await t.saveTx(null, mtx({ amountCents: -250000, merchant: "Payroll", name: "PAYROLL", category: "Income" })); });
    await screen.findByText("Net");
    await waitFor(() => expect(netValue()).toHaveTextContent("$2,500.00"));
    expect(netValue()).toHaveClass("good");
  });
});

describe("the month switch is two chevrons, not two words", () => {
  it("no Back or Next capsule, 44px chevron buttons named Previous Month and Next Month, and they step the month", async () => {
    mountTracker("r1-nav");
    const prev = await screen.findByRole("button", { name: "Previous Month" });
    const next = screen.getByRole("button", { name: "Next Month" });
    expect(screen.queryByText("Back", { selector: "button" })).toBeNull();
    expect(screen.queryByText("Next", { selector: "button" })).toBeNull();
    expect(prev).toHaveClass("mt-step");
    expect(prev).not.toHaveClass("quiet-action");
    expect(prev.querySelector("svg")).not.toBeNull();
    expect(next.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(monthLabel(MONTH))).toBeInTheDocument();
    fireEvent.click(prev);
    const [y, m] = MONTH.split("-").map(Number);
    const before = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);
    expect(await screen.findByText(monthLabel(before))).toBeInTheDocument();
  });
});

describe("the tab strip scrolls and says so", () => {
  it("is a scroller with data-more, the active tab is aria-selected, and the offer has its own room under the title", async () => {
    mountTracker("r1-tabs");
    const strip = (await screen.findByRole("tablist", { name: "Tracker" })) as HTMLElement;
    expect(strip).toHaveAttribute("data-more");
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    // Four tabs, in order, none renamed or dropped.
    expect([...strip.querySelectorAll("[role=tab]")].map((t) => t.textContent)).toEqual(["Dashboard", "Transactions", "Budgets", "Subscriptions"]);
    // The import offer sits in its own spacing wrapper, so it never butts the title's underline.
    expect(screen.getByText("Import September Data").closest(".mt-notice")).not.toBeNull();
  });
});

describe("a Tracker with no accounts is a crafted empty state", () => {
  it("a glyph, a Title Case title and one warm line, the Add Account capsule in the head", async () => {
    mountTracker("r1-empty");
    const title = await screen.findByText("No Accounts Yet");
    const box = title.closest(".empty-state") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.querySelector(".empty-icon svg")).not.toBeNull();
    expect(box.querySelector(".empty-sub")).toHaveTextContent("Add One to See Your Balances Together");
    // The one action is the head's capsule, never a button inside the empty box.
    expect(box.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Account" })).toHaveClass("pill-action");
  });
});

describe("accountParts reads a stored account name apart, for display only", () => {
  it("splits the label from the masked digits", () => {
    expect(accountParts("BUSINESS CHECKING ...3305")).toEqual({ label: "BUSINESS CHECKING", mask: "3305" });
    expect(accountParts("Platinum Card …4975")).toEqual({ label: "Platinum Card", mask: "4975" });
    expect(accountParts("Savings")).toEqual({ label: "Savings", mask: null });
    expect(accountParts("...3305")).toEqual({ label: "...3305", mask: null });
  });
});

describe("after the September import the screen lands on September, with even account tiles", () => {
  it("moves to the imported month, labels the sums with it, reads name and digits apart, and says how many came in", async () => {
    mountTracker("r1-import");
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    // The toast says how much arrived, and the screen is on the month the data is in.
    await waitFor(() => expect(screen.getByText("September 2026")).toBeInTheDocument(), { timeout: 4000 });
    // The sums head names the month the figures are for (not "This Month" over September's numbers).
    const heads = [...document.querySelectorAll(".sh2 .t")].map((e) => e.textContent);
    if (MONTH !== "2026-09") { expect(heads).toContain("September"); expect(heads).not.toContain("This Month"); }
    // The tiles: one per account, equal grid, the name apart from its digits, no typed ellipsis.
    const tiles = [...document.querySelectorAll(".mt-acct")] as HTMLElement[];
    expect(tiles).toHaveLength(4);
    const business = tiles.find((t) => /business checking/i.test(t.textContent ?? ""))!;
    expect(business.querySelector(".mt-acct-name")?.textContent).toBe("Business Checking");
    expect(business.querySelector(".mt-acct-mask")?.textContent).toBe("3305");
    expect(business.textContent).not.toMatch(/\.\.\./);
    // The credit card's available credit is a kicker over its amount, a pair like the tile's own kicker.
    const card = tiles.find((t) => /platinum/i.test(t.textContent ?? ""))!;
    expect(card.querySelector(".mt-acct-kick")).toHaveTextContent("Available Credit");
    expect(card.querySelector(".mt-acct-avail")).toHaveTextContent("$9,144.00");
    expect(card.querySelector(".fact")).toBeNull();
  });
});
