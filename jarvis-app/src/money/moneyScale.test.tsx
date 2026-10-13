// @vitest-environment jsdom
// S2 OF THE APPROVED STRIKING ROUND (issue 108, Dave 2026-10-13): "In the Money accounts card, raise the Total Balance figure to
// headline size inside the same card. Account rows stay in the same order with balances right-aligned, one step larger. Nothing
// else on the page changes." The hard constraint over all of it: the font style does not change, only the scale.
//
// jsdom has no layout, so each number is pinned where it is decided: the stylesheet text (what size, and that the rule writes
// NOTHING but a size), and the class the real component draws (which totals keep the old size). The fit itself was measured in a
// browser (390 and 360 wide, light and dark, text scale 1 and 1.4) and is in the report that came with the change.
// The cases that pin the change fail against the code as it stood before it; the ones that pin what must NOT move (the base rules,
// the lists, the row structure) pass on both, by design.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useMoney, useProfile } from "../data/NotesProvider";
import type { MoneyService } from "./MoneyService";
import type { LedgerService } from "./ledger/LedgerService";
import type { ProfileService } from "../profile/ProfileService";
import MoneyFlow from "./MoneyFlow";
import { MINUS, type AccountKind } from "./types";
import { resetToasts } from "../shared/toast";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
afterEach(() => { cleanup(); resetToasts(); localStorage.clear(); });

// ---------------------------------------------------------------------------
// The stylesheet: size only, scoped to the hero card
// ---------------------------------------------------------------------------
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RULED = strip(readFileSync(join(__dirname, "../styles/ruled.css"), "utf8"));
const DESIGN = strip(readFileSync(join(__dirname, "../styles/jarvis-design-system.css"), "utf8"));

/** The declarations of the one rule whose selector is exactly `selector` (a rule, not the tail of a longer selector). */
function rule(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp("(?:^|\\})\\s*" + esc + "\\s*\\{([^}]*)\\}").exec(css);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
}
const propsOf = (body: string) => body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(":")[0]!.trim());

const FIGURE = ".ruled .money-hero-card .money-hero-total";
const FIGURE_MID = ".ruled .money-hero-card .money-hero-total.money-hero-total-mid";
const FIGURE_LONG = ".ruled .money-hero-card .money-hero-total.money-hero-total-long";
const BALANCE = ".ruled .money-hero-card .task-row .money-amt";

describe("S2: the Total Balance is the headline of its own card, and only its size moves", () => {
  it("the figure is 12vw, capped at the display token, never under its old 34, and the rule writes nothing but the size", () => {
    const body = rule(RULED, FIGURE);
    expect(body, "a headline rule scoped to the hero card").not.toBeNull();
    expect(body).toMatch(/^font-size: max\(calc\(34px \* var\(--type-scale\)\), min\(var\(--t-display\), 12vw\)\);?$/);
    // No family, weight, tracking, colour or numeral width here: the face, the weight, the -0.02em tracking and the tabular
    // figures are the base rule's and the design system's lists, so no letterform moves.
    expect(propsOf(body!)).toEqual(["font-size"]);
  });

  it("nine figures take 10.5vw, on the same cap and floor, and that rule writes nothing but the size", () => {
    const body = rule(RULED, FIGURE_MID);
    expect(body, "the mid step has its rule").not.toBeNull();
    expect(body).toMatch(/^font-size: max\(calc\(34px \* var\(--type-scale\)\), min\(var\(--t-display\), 10\.5vw\)\);?$/);
    expect(propsOf(body!)).toEqual(["font-size"]);
  });

  it("ten or more figures keep the old size, and that rule writes nothing but the size", () => {
    const body = rule(RULED, FIGURE_LONG);
    expect(body, "the long tier has its rule").not.toBeNull();
    expect(body).toMatch(/^font-size: calc\(34px \* var\(--type-scale\)\);?$/);
    expect(propsOf(body!)).toEqual(["font-size"]);
  });

  it("the account balances go one step up the ramp (15 to 17, --t-h3), scoped to the hero card, writing nothing but the size", () => {
    const body = rule(RULED, BALANCE);
    expect(body, "a balance rule scoped to the hero card").not.toBeNull();
    expect(body).toMatch(/^font-size: var\(--t-h3\);?$/);
    expect(propsOf(body!)).toEqual(["font-size"]);
  });

  it("what the new rules sit on is untouched: Yours Until keeps its 34, and bills, set-asides and Paid This Month keep their 15", () => {
    const total = rule(RULED, ".ruled .money-hero-total");
    expect(total, "the base figure rule (it also draws Yours Until)").not.toBeNull();
    expect(total).toMatch(/font-size: calc\(34px \* var\(--type-scale\)\)/);
    expect(total).toMatch(/font-weight: var\(--w-bold\)/);
    expect(total).toMatch(/letter-spacing: -0\.02em/);
    expect(total).toMatch(/font-variant-numeric: tabular-nums/);
    const amt = rule(RULED, ".ruled .task-row .money-amt");
    expect(amt, "the base amount rule (it also draws bills, set-asides and Paid This Month)").not.toBeNull();
    expect(amt).toMatch(/font-size: calc\(15px \* var\(--type-scale\)\)/);
    expect(amt).toMatch(/font-weight: var\(--w-semi\)/);
  });

  it("the figure still wears the display face and tabular figures from the design system's own lists", () => {
    const lists = (decl: RegExp) => [...DESIGN.matchAll(new RegExp("([^{}]*)\\{\\s*" + decl.source + "\\s*\\}", "g"))].map((m) => m[1]!);
    expect(lists(/font-family:\s*var\(--f-display\);/).some((sel) => sel.includes(".money-hero-total")), "the display face").toBe(true);
    expect(lists(/font-variant-numeric:\s*tabular-nums;/).some((sel) => sel.includes(".money-hero-total")), "tabular figures").toBe(true);
    expect(lists(/font-variant-numeric:\s*tabular-nums;/).some((sel) => sel.includes(".money-amt")), "tabular figures on the balances").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The real component: which totals keep the old size, and what the new rules reach
// ---------------------------------------------------------------------------
interface Svc { money: MoneyService; ledger: LedgerService; profile: ProfileService }
function Seed({ seed, children }: { seed: (s: Svc) => Promise<void>; children: ReactNode }) {
  const money = useMoney();
  const ledger = useLedger();
  const profile = useProfile();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void seed({ money, ledger, profile }).then(() => setReady(true));
  }, [money, ledger, profile, seed]);
  return ready ? <>{children}</> : null;
}
const mount = (user: string, seed: (s: Svc) => Promise<void>) =>
  render(<NotesProvider userId={user}><Seed seed={seed}><MoneyFlow /></Seed></NotesProvider>);

type Acct = [name: string, balance: number, kind: AccountKind];
const seedAccounts = (accts: Acct[]) => async ({ money }: Svc) => {
  for (const [name, balance, kind] of accts) await money.create({ name, balance, kind });
};
const totalFigure = () => document.querySelector(".money-hero-card .money-hero-total") as HTMLElement;

// A figure is the dollar sign, a minus or a digit; the commas and the point are narrow and not counted. Eight fit at the full
// headline size (12vw) in the widest face the audit renders in; a ninth does not, so nine take the mid step (10.5vw) and ten or
// more keep the figure's old size.
type Tier = "headline" | "mid" | "old";
const TOTALS: { name: string; accts: Acct[]; text: string; tier: Tier }[] = [
  { name: "seven figures", text: "$1,284.56", tier: "headline",
    accts: [["Checking", 1904.31, "cash"], ["Savings", 5200, "savings"], ["Credit Card", 5819.75, "credit"]] },
  { name: "eight figures", text: "$54,330.45", tier: "headline",
    accts: [["Brokerage", 32540.75, "investment"], ["Checking", 4800, "cash"], ["Savings", 18230, "savings"], ["Credit Card", 1240.3, "credit"]] },
  { name: "eight figures, negative (the minus is one)", text: MINUS + "$1,234.56", tier: "headline",
    accts: [["Checking", 1000, "cash"], ["Credit Card", 2234.56, "credit"]] },
  { name: "eight figures, whole dollars", text: "$1,234,567", tier: "headline",
    accts: [["Brokerage", 1200000, "investment"], ["Checking", 34567, "cash"]] },
  { name: "nine figures", text: "$123,456.78", tier: "mid",
    accts: [["Brokerage", 100000, "investment"], ["Savings", 25000, "savings"], ["Credit Card", 1543.22, "credit"]] },
  { name: "nine figures, negative", text: MINUS + "$12,345.67", tier: "mid",
    accts: [["Brokerage", 4500, "investment"], ["Checking", 1154.33, "cash"], ["Credit Card", 18000, "credit"]] },
  { name: "ten figures", text: "$1,234,567.89", tier: "old",
    accts: [["Brokerage", 1200000, "investment"], ["Checking", 24567.89, "cash"], ["Savings", 12000, "savings"], ["Credit Card", 2000, "credit"]] },
  { name: "ten figures, negative", text: MINUS + "$123,456.78", tier: "old",
    accts: [["Brokerage", 10000, "investment"], ["Checking", 1000, "cash"], ["Credit Card", 134456.78, "credit"]] },
];

describe("S2: a total that would run out of the card takes a smaller step", () => {
  it.each(TOTALS)("$name is drawn at the $tier size", async ({ name, accts, text, tier }) => {
    mount("s2-tier-" + name.replace(/\W+/g, "-"), seedAccounts(accts));
    await screen.findByText("Total Balance");
    expect(totalFigure().textContent).toBe(text);
    expect(totalFigure().classList.contains("money-hero-total-mid"), "mid step").toBe(tier === "mid");
    expect(totalFigure().classList.contains("money-hero-total-long"), "old size").toBe(tier === "old");
  });
});

describe("S2: the new rules reach the Total Balance and the account balances, and nothing else on the page", () => {
  const day = (n: number) => addDays(todayISO(), n);
  const seedPage = async (svc: Svc) => {
    await seedAccounts([["Brokerage", 32540.75, "investment"], ["Checking", 4800, "cash"], ["Savings", 18230, "savings"], ["Credit Card", 1240.3, "credit"]])(svc);
    // The rest of the page: a payday (the Yours Until figure, which shares .money-hero-total), a set-aside and a bill.
    await svc.profile.save({ template: "personal", payday: { amount: 3000, next: day(5), freq: "biweekly" }, envelopes: [{ id: "e1", name: "emergency fund", amount: 300 }] });
    const r = await svc.ledger.addBill({ vendor: "Rent", amount: 2200, dueDate: day(2) });
    if (!r.ok) throw new Error(r.errors.join());
  };

  it("the figure rule reaches the Total Balance only: Yours Until is a .money-hero-total outside the card and keeps its size", async () => {
    mount("s2-reach-figure", seedPage);
    await screen.findByText("Total Balance");
    const figures = [...document.querySelectorAll<HTMLElement>(".money-hero-total")];
    expect(figures.length, "Yours Until and the Total Balance both draw a .money-hero-total").toBe(2);
    const reachedFigures = document.querySelectorAll(FIGURE);
    expect(reachedFigures).toHaveLength(1);
    expect(reachedFigures[0]).toBe(totalFigure());
    const yours = figures.find((f) => f !== totalFigure())!;
    expect(yours.closest(".money-hero-card")).toBeNull();
    expect(yours.classList.contains("money-hero-total-mid")).toBe(false);
    expect(yours.classList.contains("money-hero-total-long")).toBe(false);
  });

  it("the balance rule reaches the four account balances, in their order, and not a bill, a set-aside or the paid line", async () => {
    mount("s2-reach-balance", seedPage);
    await screen.findByText("Total Balance");
    await screen.findByText("Rent", { selector: ".task-name" });
    const reached = [...document.querySelectorAll(BALANCE)].map((e) => e.textContent);
    expect(reached).toEqual(["$32,540.75", "$4,800.00", MINUS + "$1,240.30", "$18,230.00"]);
    // The page holds other balances (the bill, the set-aside), and the rule does not touch them.
    expect(document.querySelectorAll(".money-amt").length).toBeGreaterThan(reached.length);
    for (const el of document.querySelectorAll(".money-amt")) {
      if (!el.closest(".money-hero-card")) expect(el.matches(BALANCE), el.textContent ?? "").toBe(false);
    }
  });

  it("the account rows keep their order and each balance is the last thing in its row, which is what right-aligns it", async () => {
    mount("s2-rows", seedPage);
    await screen.findByText("Total Balance");
    const rows = [...document.querySelectorAll<HTMLElement>(".money-hero-card .task-row")];
    expect(rows.map((r) => r.querySelector(".task-name")?.textContent)).toEqual(["Brokerage", "Checking", "Credit Card", "Savings"]);
    for (const r of rows) {
      const amt = r.querySelector(":scope > .money-amt");
      expect(amt, r.textContent ?? "").not.toBeNull();
      expect(r.lastElementChild).toBe(amt);
    }
  });
});
