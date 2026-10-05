// @vitest-environment jsdom
// THE VISUAL CATALOG, ON EVERY SCREEN OF THE MONEY MODULE (Dave, 2026-10-05,
// "I am sick of this": a thin grey subtext came back on the Email card and he
// spent hours fixing exactly that once). The rulebook's R1 to R8 are asserted
// here as STRUCTURE in the DOM, not as pixels, so they hold in both themes and
// at every type scale:
//   - a separator is drawn by CSS: no middle dot, bullet or " - " inside a fact;
//   - a facts line with nothing to say is not drawn at all;
//   - at most one coloured fact (amber, red, green) on a facts line;
//   - at most ONE untoned (grey) run per row: every other fact is a colour from
//     the key, small caps, a white number or a mark;
//   - a row with nothing to say shows nothing (no "None", "Nothing Tracked Yet"
//     under a head whose count already says it);
//   - a clock time is 12-hour with AM or PM;
//   - every word the app writes in a fact is Title Case (small words lowercase).
// Each screen below renders the REAL component through the real markup and runs
// the same check. The old markup failed it; the fixes pass it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useLedger, useTasks, useTracker } from "../data/NotesProvider";
import type { LedgerService } from "./ledger/LedgerService";
import type { TasksService } from "../tasks/TasksService";
import type { TrackerService } from "./TrackerService";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { resetToasts } from "../shared/toast";
import MoneyFlow from "./MoneyFlow";
import { loneActionBoxes } from "../laws/catalogCheck";
import MatchesCard from "./screens/MatchesCard";
import TrackerScreen from "./screens/TrackerScreen";
import ReceiptsSection from "./screens/ReceiptsSection";
import BillDetailSheet from "./screens/BillDetailSheet";
import ReceiptDetailSheet from "./screens/ReceiptDetailSheet";
import HistoryList from "./screens/HistoryList";
import { LinkedFacts, Amounts } from "./MoneyFacts";
import { buildBill, correctBill, markPaid, unmarkPaid } from "./ledger/bill";
import type { Bill, BillData, Receipt } from "./ledger/types";
import { thisMonth, type TrackerTx, type TrackerTxData } from "./tracker";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
afterEach(() => { cleanup(); vi.restoreAllMocks(); resetToasts(); });

// ---------------------------------------------------------------------------
// The check. Every screen below runs it over its own DOM.
// ---------------------------------------------------------------------------
const SEPARATOR = /[·•]| - /;
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "per", "the", "to", "with"]);
const TONES = ["warn", "red", "good"] as const;
const TONED = ["warn", "red", "good", "date", "est", "cat", "st"];
const isTitleCase = (text: string): boolean => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.every((w, i) => {
    if (/[@\d$#&]/.test(w[0] ?? "") || w.includes("@") || w.includes("/")) return true; // an amount, a number, data
    const bare = w.replace(/^[^A-Za-z]+/, "");
    if (!bare) return true;
    if (bare === bare.toUpperCase() && bare.length > 1) return true; // the bank's own capitals
    if (SMALL.has(bare.toLowerCase()) && i !== 0 && i !== words.length - 1) return bare === bare.toLowerCase();
    return bare[0] === bare[0]!.toUpperCase();
  });
};
// What counts as a row: the nearest of these around a run of text.
const ROW = ".task-row, .row, .mt-note, .mt-cat, .mt-acct, .budget-row";

/** A run of text in the row's one grey: an untoned fact, an untoned goal run, or a bare meta line. */
function isGrey(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  if (el.classList.contains("conn-meta")) {
    // A meta line made of facts is judged fact by fact; a bare one is a grey run itself.
    return !el.querySelector(":scope > .fact, :scope > .facts, :scope > .fact-wrap") && !el.closest(".money-hero");
  }
  if (TONED.some((c) => el.classList.contains(c))) return false;
  const only = el.firstElementChild;
  if (only && only.tagName === "B" && only.textContent === text) return false; // a white number with no state
  return true;
}

/** Every way a catalog line can be wrong, in the DOM under `root`. Empty means it follows the catalog. */
export function catalogViolations(root: ParentNode): string[] {
  const bad: string[] = [];
  for (const line of root.querySelectorAll(".facts, .conn-meta, .r-k")) {
    const facts = [...line.querySelectorAll(":scope > .fact, :scope > .r-goal")];
    if (facts.length === 0 && line.classList.contains("facts")) bad.push("a facts line with no fact in it: " + JSON.stringify(line.textContent));
    const coloured = facts.filter((f) => TONES.some((t) => f.classList.contains(t)));
    if (coloured.length > 1) bad.push("two coloured facts on one line: " + coloured.map((f) => f.textContent).join(" | "));
  }
  for (const f of root.querySelectorAll(".fact, .r-goal")) {
    const text = f.textContent ?? "";
    if (SEPARATOR.test(text)) bad.push("a separator baked into a fact: " + JSON.stringify(text));
    if (/\b\d{1,2}:\d{2}\b/.test(text) && !/\b(AM|PM)\b/i.test(text)) bad.push("a 24-hour clock in a fact: " + JSON.stringify(text));
    if (!isTitleCase(text)) bad.push("a fact that is not Title Case: " + JSON.stringify(text));
  }
  for (const m of root.querySelectorAll(".conn-meta")) {
    if (m.querySelector(":scope > .fact") === null && SEPARATOR.test(m.textContent ?? "") && !m.closest(".xs-note, .input-hint"))
      bad.push("a separator baked into a meta line: " + JSON.stringify(m.textContent));
  }
  const greys = new Map<Element, string[]>();
  for (const g of root.querySelectorAll(".fact, .r-goal, .conn-meta")) {
    if (!isGrey(g)) continue;
    const row = g.closest(ROW);
    if (row) greys.set(row, [...(greys.get(row) ?? []), (g.textContent ?? "").trim()]);
  }
  for (const [, list] of greys) if (list.length > 1) bad.push("more than one grey run on one row: " + list.join(" | "));
  return bad;
}

describe("the check itself catches what Dave caught", () => {
  const html = (s: string): HTMLElement => { const d = document.createElement("div"); d.innerHTML = s; return d; };
  it("two greys on one row, a baked dot, a lowercase word, a 24-hour time and an empty facts line all fail", () => {
    expect(catalogViolations(html('<div class="row"><div class="facts"><span class="fact">Open Email to Review</span><span class="fact">Task</span></div></div>'))).toHaveLength(1);
    expect(catalogViolations(html('<div class="row"><div class="conn-meta"><span class="fact">Task · Due Today</span></div></div>')).length).toBeGreaterThan(0);
    expect(catalogViolations(html('<div class="row"><div class="facts"><span class="fact">due soon</span></div></div>')).length).toBeGreaterThan(0);
    expect(catalogViolations(html('<div class="row"><div class="facts"><span class="fact">Due 14:30</span></div></div>')).length).toBeGreaterThan(0);
    expect(catalogViolations(html('<div class="row"><div class="facts"></div></div>')).length).toBeGreaterThan(0);
  });
  it("one grey beside a white number, a date, a tone and a mark is a clean row", () => {
    expect(catalogViolations(html('<div class="row"><div class="facts"><span class="fact date">Sep 8</span><span class="fact good">Matched</span><span class="fact"><b>$47.12</b></span><span class="fact">Groceries</span></div></div>'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Harnesses over the real provider, the way the module's own tests mount.
// ---------------------------------------------------------------------------
interface Handles { ledger: LedgerService; tracker: TrackerService; tasks: TasksService }
function Seed({ seed, children }: { seed: (h: Handles) => Promise<void>; children: ReactNode }) {
  const ledger = useLedger();
  const tracker = useTracker();
  const tasks = useTasks();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void seed({ ledger, tracker, tasks }).then(() => setReady(true));
  }, [ledger, tracker, tasks, seed]);
  return ready ? <>{children}</> : null;
}
const mount = (user: string, seed: (h: Handles) => Promise<void>, ui: ReactNode) =>
  render(<NotesProvider userId={user}><Seed seed={seed}>{ui}</Seed></NotesProvider>);

const T = todayISO();
const MONTH = thisMonth();
const mday = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
// The month's short name, so the day facts read the same in any month the suite runs.
const MON = new Date(MONTH + "-08T12:00:00").toLocaleString("en-US", { month: "short" });
const txData = (over: Partial<TrackerTxData> = {}): TrackerTxData => ({
  date: mday(8), month: MONTH, merchant: "Stop & Shop", name: "STOP & SHOP #123", amountCents: 4712, category: "Groceries", account: "", ...over,
});
const addBill = async (l: LedgerService, i: Parameters<LedgerService["addBill"]>[0]) => {
  const r = await l.addBill(i);
  if (!r.ok) throw new Error(r.errors.join());
  return r.id;
};

// ---------------------------------------------------------------------------
// MATCHES CARD: four greys on one row, two of them the vendor the headline says
// ---------------------------------------------------------------------------
describe("the Matches card: the headline is the title, the two sides carry only what it does not", () => {
  it("a receipt and its payment: white label and amount, a small-caps day, and no grey run at all", async () => {
    const { container } = mount("cat-match", async (h) => {
      await h.tracker.saveTx(null, txData());
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: mday(8) }, "manual", T);
      if (!r.ok) throw new Error("seed");
    }, <MatchesCard />);
    const row = (await waitFor(() => { const r = container.querySelector(".match-row"); if (!r) throw new Error("no row"); return r as HTMLElement; }));
    const lines = [...row.querySelectorAll(":scope .facts")];
    expect(lines).toHaveLength(2);
    expect([...lines[0]!.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Receipt", "$47.12", `${MON} 8`]);
    expect([...lines[1]!.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Payment", "$47.12", `${MON} 8`]);
    expect(row.querySelectorAll(".fact.date")).toHaveLength(2);
    // Not a single untoned grey run: the name the headline already says is not said again.
    expect([...row.querySelectorAll(".fact")].filter(isGrey)).toEqual([]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a bill and its payment follow the same shape", async () => {
    const { container } = mount("cat-match-bill", async (h) => {
      await h.tracker.saveTx(null, txData({ merchant: "ConEdison", name: "CONED", amountCents: 8412, category: "Utilities", date: mday(4) }));
      await addBill(h.ledger, { vendor: "ConEdison", amount: 84.12, dueDate: mday(5) });
    }, <MatchesCard />);
    const row = await waitFor(() => { const r = container.querySelector(".match-row"); if (!r) throw new Error("no row"); return r as HTMLElement; });
    expect([...row.querySelectorAll(".facts")[0]!.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Bill", "$84.12", `${new Date(mday(5) + "T12:00:00").toLocaleString("en-US", { month: "short" })} 5`]);
    expect(catalogViolations(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE BILL'S OWN PAGE
// ---------------------------------------------------------------------------
const NOW = () => "2026-10-02T12:00:00.000Z";
function makeBill(over: { vendor?: string; amount?: number; dueDate?: string } = {}): BillData {
  const r = buildBill({ vendor: "ConEdison", amount: 84.12, ...over }, "manual", "user", NOW);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
}
const bill = (data: BillData): Bill => ({ id: "b1", data });
// A sheet is portalled to the body, so these read document.body, not the render container.
const sheet = (data: BillData) => { render(
  <NotesProvider userId="cat-bill-sheet">
    <BillDetailSheet bill={bill(data)} today="2026-10-03" onClose={() => {}} onEdit={() => {}} onMarkPaid={() => {}} onRemovePaid={() => {}} onDelete={() => {}} />
  </NotesProvider>,
); return { container: document.body }; };

describe("the bill's own page: History is one grey per entry, and a bill with no date has no Due row", () => {
  it("a correction of three fields: who did it is the only grey, each change is one white fact, no separate 'to' grey", () => {
    let d = makeBill({ dueDate: "2026-10-05" });
    const c = correctBill(d, { amount: 90, dueDate: null, notes: "Gas" }, "user", () => "2026-10-03T09:00:00.000Z");
    if (!c.ok) throw new Error("x");
    d = c.value.next;
    const { container } = sheet(d);
    const entry = [...container.querySelectorAll(".row")].find((r) => r.textContent?.startsWith("Corrected"))!;
    expect(entry).toBeTruthy();
    const facts = [...entry.querySelectorAll(".fact")];
    expect(facts.map((f) => f.textContent)).toEqual([
      "You", "Oct 3",
      "Amount $84.12 to $90", "Due Date Oct 5 to None", "Notes None to Gas",
    ]);
    // who is the one grey; the day is a small-caps date; every change is a white number-style fact
    expect(facts.filter(isGrey).map((f) => f.textContent)).toEqual(["You"]);
    expect(facts.filter((f) => f.firstElementChild?.tagName === "B" && f.firstElementChild.textContent === f.textContent)).toHaveLength(3);
    // The old shape: the field name and the word "to" in their own grey spans.
    expect(container.querySelector(".bill-change-k, .bill-change-to, .bill-change-v")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });

  it("evidence in a change is Title Case, not a sentence in a facts line", () => {
    const p = markPaid(makeBill(), { type: "user_confirmed" }, "2026-10-01", "user", NOW);
    if (!p.ok) throw new Error("x");
    const { container } = sheet(unmarkPaid(p.next, "user", NOW));
    const text = [...container.querySelectorAll(".fact")].map((f) => f.textContent);
    expect(text).toContain("Evidence None to You Confirmed It");
    expect(text.join("|")).not.toMatch(/You confirmed it/);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a bill with no due date draws no Due row, not a 'None' placeholder", () => {
    const { container } = sheet(makeBill());
    expect(within(container as HTMLElement).queryByText("Due", { selector: ".conn-name" })).toBeNull();
    expect(container.textContent).not.toMatch(/DueNone|None/);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a bill with a due date still draws it", () => {
    const { container } = sheet(makeBill({ dueDate: "2026-10-05" }));
    const due = within(container as HTMLElement).getByText("Due", { selector: ".conn-name" });
    expect(due.parentElement).toHaveTextContent("DueOct 5");
  });
});

// ---------------------------------------------------------------------------
// RECEIPTS: the list, and the receipt's own page
// ---------------------------------------------------------------------------
describe("the Receipts list: a matched receipt is green, the category is the one grey, and the free text goes last", () => {
  it("date, Matched (green), category: one grey on the row", async () => {
    const { container } = mount("cat-rcpt-list", async (h) => {
      const txId = (await h.tracker.saveTx(null, txData()))!;
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: mday(8), category: "Groceries" }, "manual", T);
      if (!r.ok) throw new Error("seed");
      const a = await h.ledger.approveReceiptMatch(r.id, txId);
      if (!a.ok) throw new Error("link");
    }, <ReceiptsSection />);
    const row = await waitFor(() => { const r = container.querySelector(".file-row"); if (!r) throw new Error("no row"); return r as HTMLElement; });
    expect([...row.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual([expect.stringMatching(/^[A-Z][a-z]{2} 8$/), "Matched", "Groceries"]);
    expect(row.querySelector(".fact.good")).toHaveTextContent("Matched");
    expect([...row.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["Groceries"]);
    expect(catalogViolations(container)).toEqual([]);
  });
});

const receipt = (over: Partial<Receipt["data"]> = {}): Receipt => ({
  id: "r1",
  data: {
    vendor: "Stop & Shop", amountCents: 4712, currency: "USD", transactionDate: "2026-09-08", category: "Groceries",
    linkedTransactionId: "t1", source: "manual", fingerprint: "f", history: [],
    ...over,
  } as unknown as Receipt["data"],
});
const tx = (): TrackerTx => ({ id: "t1", data: txData({ date: "2026-09-08", merchant: "Stop & Shop" }) });
const receiptSheet = (o: { linked?: boolean; attachment?: boolean } = {}) => { render(
  <ReceiptDetailSheet receipt={receipt(o.linked === false ? { linkedTransactionId: undefined } : {})} linked={o.linked === false ? undefined : tx()}
    categories={["Groceries"]} attachmentName={o.attachment ? "receipt.jpg" : undefined} attachmentUrl={null}
    onSave={async () => true} onUnmatch={() => {}} onDelete={() => {}} onCancel={() => {}} />,
); return { container: document.body }; };

describe("the receipt's own page", () => {
  it("the matched payment is separate facts, a white amount and a small-caps day, never one joined string; the vendor the sheet already says is not said again", () => {
    const { container } = receiptSheet();
    const row = [...container.querySelectorAll(".row")].find((r) => r.textContent?.startsWith("Matched to a Payment"))!;
    expect([...row.querySelectorAll(".conn-meta > .fact")].map((f) => f.textContent)).toEqual(["$47.12", "Sep 8"]);
    expect(row.querySelector(".conn-meta > .fact.date")).toHaveTextContent("Sep 8");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a payment under another name says it, last, as the row's one grey", () => {
    const { container } = render(<div className="conn-meta"><LinkedFacts name="STOP N SHOP #4412" sameAs="Stop & Shop" cents={4712} day="2026-09-08" /></div>);
    expect([...container.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["$47.12", "Sep 8", "STOP N SHOP #4412"]);
    expect([...container.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["STOP N SHOP #4412"]);
  });

  it("an attachment row does not say 'Tap to Open' under itself: the row is the open", () => {
    const { container } = receiptSheet({ attachment: true });
    const row = [...container.querySelectorAll(".row")].find((r) => r.textContent?.includes("receipt.jpg"))!;
    expect(row.querySelector(".conn-meta")).toBeNull();
    expect(container.textContent).not.toMatch(/Tap to Open/);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("History lists each change as a white fact on a line of its own: no grey, and nothing clipped", () => {
    const { container } = render(<HistoryList history={[{ at: "2026-10-03T10:00:00.000Z", by: "user", action: "corrected", changes: { amountCents: { from: 4712, to: 4800 }, category: { from: "Groceries", to: "Household" } } }]} />);
    expect(container.querySelector(".row .facts")).toBeNull();
    // The day on its own line and one change per line: no grey, nothing clipped, no separator left hanging at a wrap.
    const lines = [...container.querySelectorAll(".row .conn-meta")];
    expect(lines.map((m) => m.textContent)).toEqual(["Oct 3", "Amount $47.12 to $48.00", "Category Groceries to Household"]);
    expect(lines.every((m) => m.querySelectorAll(":scope > .fact").length === 1)).toBe(true);
    expect([...container.querySelectorAll(".row .fact")].filter(isGrey)).toEqual([]);
    expect(catalogViolations(container)).toEqual([]);
  });
});

describe("the shared money facts", () => {
  it("Amounts steps each dollar amount up to a white number and leaves the words alone", () => {
    const { container } = render(<span><Amounts text="$2,000 Coming in, $500 of Bills Out" /></span>);
    expect([...container.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["$2,000", "$500"]);
  });
  it("LinkedFacts draws only what it has: no day, no name, no empty fact", () => {
    const { container } = render(<div className="conn-meta"><LinkedFacts cents={1500} /></div>);
    expect([...container.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["$15.00"]);
  });
});

// ---------------------------------------------------------------------------
// THE MONEY PAGE: the recurring offer, a reopened bill
// ---------------------------------------------------------------------------
describe("the Money page: the recurring offer and a bill that waits on you", () => {
  const month = (n: number) => {
    const d = new Date(T + "T12:00:00");
    d.setMonth(d.getMonth() - n, 1);
    return todayISO(d);
  };

  it("Make It Monthly: the question is the name of a clean row, the bill is a white fact and the count the one grey, and no pill sits on it", async () => {
    const { container } = mount("cat-offer", async (h) => { for (const n of [2, 1, 0]) await addBill(h.ledger, { vendor: "Offer Co", amount: 84.12, dueDate: month(n) }); }, <MoneyFlow />);
    const question = await screen.findByText("Make It Monthly?");
    // A name with the row's own width, not a fact on a line beside pills where it was cut to nothing.
    expect(question).toHaveClass("task-name");
    expect(question.closest(".fact")).toBeNull();
    const row = question.closest(".task-row") as HTMLElement;
    // Clean row (Dave 2026-10-05, locked): no pill, no capsule; Yes and Not Now are the tap's sheet and the swipe.
    expect(row.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect([...row.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Offer Co, $84.12", "3 Months in a Row"]);
    expect([...row.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["3 Months in a Row"]);
    // The quickest answer is the swipe's first button.
    expect(screen.getByRole("button", { name: "Not Now Make It Monthly" })).toBeInTheDocument();
    expect(catalogViolations(row)).toEqual([]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("tapping the offer's row asks: Make It Monthly, Not Now, or open the bill", async () => {
    mount("cat-offer-sheet", async (h) => { for (const n of [2, 1, 0]) await addBill(h.ledger, { vendor: "Offer Co", amount: 84.12, dueDate: month(n) }); }, <MoneyFlow />);
    fireEvent.click(await screen.findByText("Make It Monthly?"));
    expect(await screen.findByRole("button", { name: "Make It Monthly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not Now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Bill" })).toBeInTheDocument();
    // Not Now answers it and the row goes.
    fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
    await waitFor(() => expect(screen.queryByText("Make It Monthly?")).toBeNull());
  });

  it("a paid bill whose amount was corrected waits for the person: the amber, not the grey", async () => {
    const { container } = mount("cat-reconfirm", async (h) => {
      const id = await addBill(h.ledger, { vendor: "Water", amount: 40, dueDate: addDays(T, -1) });
      await h.ledger.markBillPaidByUser(id, addDays(T, -1));
      await h.ledger.correctBill(id, { amount: 45 });
    }, <MoneyFlow />);
    const line = await screen.findByText("Confirm It Is Still Paid", { selector: ".task-row *" });
    expect(line).toHaveClass("fact", "warn");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("every bill row on the page follows the catalog: late, due soon, autopay, paid, and none with a date", async () => {
    const { container } = mount("cat-bill-rows", async (h) => {
      await addBill(h.ledger, { vendor: "Late Co", amount: 60, dueDate: addDays(T, -3) });
      await addBill(h.ledger, { vendor: "Soon Co", amount: 84.12, dueDate: addDays(T, 3) });
      await addBill(h.ledger, { vendor: "Far Co", amount: 20, dueDate: addDays(T, 20) });
      await addBill(h.ledger, { vendor: "Auto Co", amount: 15, dueDate: addDays(T, 5), autopay: true });
      await addBill(h.ledger, { vendor: "Bare Co", amount: 40 });
      const p = await addBill(h.ledger, { vendor: "Paid Co", amount: 30, dueDate: addDays(T, -1) });
      await h.ledger.markBillPaidByUser(p, addDays(T, -1));
    }, <MoneyFlow />);
    await screen.findByText("Soon Co");
    expect(container.querySelectorAll(".task-row .task-name").length).toBeGreaterThan(5);
    // A bill with nothing to say has no line under its name at all.
    expect((screen.getByText("Bare Co").closest(".task-title") as HTMLElement).querySelector(".r-k")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE TRACKER
// ---------------------------------------------------------------------------
const tab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }, { timeout: 4000 }));

describe("the Tracker: transactions, budgets, subscriptions and the dashboard", () => {
  it("a matched payment is green and the category is its one grey, in that order", async () => {
    const { container } = mount("cat-tx", async (h) => {
      const txId = (await h.tracker.saveTx(null, txData()))!;
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: mday(8), category: "Groceries" }, "manual", T);
      if (!r.ok) throw new Error("seed");
      await h.ledger.approveReceiptMatch(r.id, txId);
    }, <TrackerScreen onBack={() => {}} />);
    await tab("Activity");
    const row = (await screen.findByText("Stop & Shop", { selector: ".task-name" })).closest(".task-row") as HTMLElement;
    expect([...row.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual([expect.stringMatching(/^[A-Z][a-z]{2} 8$/), "Matched", "Groceries"]);
    expect(row.querySelector(".fact.good")).toHaveTextContent("Matched");
    expect([...row.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["Groceries"]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a payment's sheet names what it is matched to as separate facts, for a receipt and for a bill", async () => {
    mount("cat-tx-sheet", async (h) => {
      const txId = (await h.tracker.saveTx(null, txData()))!;
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: mday(8), category: "Groceries" }, "manual", T);
      if (!r.ok) throw new Error("seed");
      await h.ledger.approveReceiptMatch(r.id, txId);
      const tx2 = (await h.tracker.saveTx(null, txData({ merchant: "ConEdison", name: "CONED", amountCents: 8412, category: "Utilities", date: mday(4) })))!;
      const b = await addBill(h.ledger, { vendor: "ConEdison", amount: 84.12, dueDate: mday(5) });
      await h.ledger.approveBillMatch(b, tx2);
    }, <TrackerScreen onBack={() => {}} />);
    await tab("Activity");
    fireEvent.click((await screen.findByText("Stop & Shop", { selector: ".task-name" })).closest(".task-row")!);
    await screen.findByText("Edit Transaction");
    // Twice: the sheet's Match row, and the line the link wrote in its history. Unmatch is an action row of its own, never a capsule on the match row.
    expect(screen.getByText("Unmatch Receipt")).toBeInTheDocument();
    expect(document.querySelector(".xs .pill-act")).toBeNull();
    const recRow = screen.getAllByText("Matched to a Receipt").map((n) => n.closest(".row") as HTMLElement).find((r) => r.querySelector(".conn-meta > .fact.date"))!;
    expect([...recRow.querySelectorAll(".conn-meta > .fact")].map((f) => f.textContent)).toEqual(["$47.12", `${MON} 8`]);
    expect(recRow.querySelector(".conn-meta > .fact.date")).toBeTruthy();
    expect(catalogViolations(document.body)).toEqual([]);
    fireEvent.click(screen.getAllByText("Cancel")[0]!);
    await waitFor(() => expect(screen.queryByText("Edit Transaction")).toBeNull());
    fireEvent.click((await screen.findByText("ConEdison", { selector: ".task-name" })).closest(".task-row")!);
    await screen.findByText("Edit Transaction");
    const billRow = (await screen.findByText("Pays a Bill")).closest(".row") as HTMLElement;
    expect([...billRow.querySelectorAll(".conn-meta > .fact")].map((f) => f.textContent)).toEqual(["$84.12"]);
    expect(catalogViolations(document.body)).toEqual([]);
  });

  it("nothing tracked: no placeholder row under an empty head, on transactions or on subscriptions, and no empty card", async () => {
    const { container } = mount("cat-empty", async () => {}, <TrackerScreen onBack={() => {}} />);
    await tab("Activity");
    await screen.findByText("Add Manually");
    expect(container.textContent).not.toMatch(/Nothing (Tracked Yet|Matches)/);
    await tab("Subscriptions");
    await screen.findByRole("button", { name: "Add a Subscription" });
    expect(container.textContent).not.toMatch(/Nothing Tracked Yet/);
    // With nothing in it the section is its head and the capsule: no card at all (rule 12), and the add is the head's.
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.startsWith("Subscriptions"))!;
    expect(head.querySelector(".pill-action")).toHaveAccessibleName("Add a Subscription");
    expect(head.nextElementSibling?.querySelector(".card") ?? null).toBeNull();
    expect(loneActionBoxes(container)).toEqual([]);
    await tab("Overview");
    expect(container.textContent).not.toMatch(/Nothing Spent This Month/);
    expect([...container.querySelectorAll(".sh2 .t")].map((t) => t.textContent)).not.toContain("Spending by Category");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a filter that hides every row still says so (the head's 0 does not say why)", async () => {
    mount("cat-filter", async (h) => { await h.tracker.saveTx(null, txData()); }, <TrackerScreen onBack={() => {}} />);
    await tab("Activity");
    fireEvent.change(await screen.findByLabelText("Search transactions"), { target: { value: "zzzz" } });
    expect(await screen.findByText("Nothing Matches")).toBeInTheDocument();
  });

  it("a differing receipt and payment: the vendor is white and the payment counting is green on one line, what each says is the one grey under it, nothing on a clipping facts line", async () => {
    const { container } = mount("cat-discrepancy", async (h) => {
      await h.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 0, savingsTargetCents: 0, allocations: { Groceries: 20000 } });
      const txId = (await h.tracker.saveTx(null, txData({ amountCents: 6000 })))!;
      const r = await h.ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: mday(8), category: "Groceries" }, "manual", T);
      if (!r.ok) throw new Error("seed");
      await h.ledger.approveReceiptMatch(r.id, txId);
    }, <TrackerScreen onBack={() => {}} />);
    await tab("Budgets");
    const says = await screen.findByText("Receipt Says $47.12, Payment Says $60.00");
    const note = says.closest(".mt-note") as HTMLElement;
    expect(note.querySelector(".facts")).toBeNull();
    expect([...note.querySelectorAll(".conn-meta")].map((l) => l.textContent)).toEqual(["Stop & ShopCounting the Payment", "Receipt Says $47.12, Payment Says $60.00"]);
    expect(note.querySelector(".fact.good")).toHaveTextContent("Counting the Payment");
    expect([...note.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["Receipt Says $47.12, Payment Says $60.00"]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("the copied-from note is the field note under the card, not a second grey fact stacked on Spent", async () => {
    const prev = (() => { const [y, m] = MONTH.split("-").map(Number); const d = new Date(y!, m! - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
    const { container } = mount("cat-copied", async (h) => {
      await h.tracker.saveBudget({ month: prev, expectedIncomeCents: 0, savingsTargetCents: 0, allocations: { Groceries: 20000 } });
    }, <TrackerScreen onBack={() => {}} />);
    await tab("Budgets");
    const note = await screen.findByText(/^Limits Copied From /);
    expect(note).toHaveClass("input-hint");
    expect(note.closest(".mt-note")).toBeNull();
    expect(container.querySelectorAll(".mt-note .fact")).toHaveLength(1);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a budget row, a subscription and the dashboard's categories and accounts follow the catalog", async () => {
    const { container } = mount("cat-tracker-all", async (h) => {
      await h.tracker.saveBudget({ month: MONTH, expectedIncomeCents: 500000, savingsTargetCents: 50000, allocations: { Groceries: 10000, Dining: 2000 } });
      await h.tracker.saveTx(null, txData({ amountCents: 6000 }));
      await h.tracker.saveTx(null, txData({ merchant: "Chipotle", name: "CHIPOTLE", category: "Dining", amountCents: 6000, date: mday(9) }));
      await h.tracker.saveAccount(null, { name: "Visa", type: "credit card", currentBalanceCents: 120000, availableBalanceCents: 380000 });
      await h.tracker.saveSub(null, { merchantName: "netflix", amountCents: 1599, frequency: "Monthly", status: "active" });
      await h.tracker.saveSub(null, { merchantName: "hulu", amountCents: 999, frequency: "Monthly", status: "cancelled" });
    }, <TrackerScreen onBack={() => {}} />);
    await screen.findByText("Visa");
    expect(catalogViolations(container)).toEqual([]);
    await tab("Budgets");
    await screen.findByText("Remaining", { exact: false });
    expect(container.querySelector(".facts .fact.red")).toHaveTextContent("$40.00 Over");
    expect(catalogViolations(container)).toEqual([]);
    await tab("Subscriptions");
    await screen.findByText("Netflix");
    expect(catalogViolations(container)).toEqual([]);
  });
});
