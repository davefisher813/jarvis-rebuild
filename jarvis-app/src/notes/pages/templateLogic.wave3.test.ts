// TEMPLATES WAVE 3: pointers only, confirmation, what is coming up, row order, the debt plan, the business ledger, and what the app suggests.
import { describe, it, expect } from "vitest";
import { newTemplatePage, TEMPLATES, TEMPLATE_KEYS } from "./templateDefs";
import { addRecord } from "./pageModel";
import {
  looksLikeSecret, secretIn, secretFieldName, confirmRecord, confirmAll, confirmState, unconfirmedCount, nextYearly, dueFact, daysBetween, orderedRecords,
  payoffPlan, monthsWords, debtsOf, groupedRecords,
} from "./templateLogic";
import { businessRows, ledgerFilter } from "./bizLedger";
import { accomplishmentSuggestions, birthdaySuggestions } from "./appSuggest";
import type { TrackerTx } from "../../money/tracker";
import type { Receipt } from "../../money/ledger/types";
import { planImport, proposeMapping } from "./importMap";

describe("the catalog", () => {
  it("every template has a unique key, a shelf, Title Case words and a wave", () => {
    for (const k of TEMPLATE_KEYS) {
      const d = TEMPLATES[k];
      expect(d.key).toBe(k);
      expect(d.fields.some((f) => f.key === d.headline), k).toBe(true);
      expect(new Set(d.fields.map((f) => f.key)).size, k).toBe(d.fields.length);
      for (const s of d.show) expect(d.fields.some((f) => f.key === s), `${k} shows ${s}`).toBe(true);
      if (d.due) expect(d.fields.some((f) => f.key === d.due!.key && f.type === "date"), `${k} due`).toBe(true);
      if (d.parent) expect(TEMPLATES[d.parent as keyof typeof TEMPLATES], `${k} parent`).toBeTruthy();
    }
  });
  it("wave 3 has the fourteen library templates, with their presets and entry points beside them", () => {
    const w3 = TEMPLATE_KEYS.filter((k) => TEMPLATES[k].wave === 3);
    const top = w3.filter((k) => !TEMPLATES[k].parent);
    expect(top.length).toBe(14);
    expect(w3.length - top.length).toBe(6);
  });
});

// THE 2026-10-13 BUILD SPEC'S FINAL LIST, the definition-level lines the defs lacked (compared 2026-10-17): Home and Vehicle Book's
// Purchases and Warranties section and the Inventory preset's "where its receipt is"; Money Map's Subscriptions and Renewals and
// For My Family sections; the Expenses to Submit preset's reimbursement status with its headings following it; Accomplishments and
// Milestones under both Life and Professional. The picker still holds forty templates: a second shelf is a second row, not a
// second template.
describe("the final list's definitions", () => {
  it("Home and Vehicle Book has a Purchases and Warranties heading, and Home Inventory says where the receipt is", () => {
    expect(TEMPLATES.homebook.sections).toEqual(["Home", "Vehicles", "Appliances", "Purchases and Warranties"]);
    expect(newTemplatePage("homebook").sections!.map((s) => s.label)).toContain("Purchases and Warranties");
    expect(TEMPLATES.homebook.suggested!.find((f) => f.key === "warranty")).toMatchObject({ label: "Warranty Ends", type: "date" });
    expect(TEMPLATES.inventory.fields.find((f) => f.key === "receipt")).toMatchObject({ label: "Where the Receipt Is", type: "text" });
  });
  it("Money Map has Subscriptions and Renewals and For My Family, still pointers only", () => {
    expect(TEMPLATES.moneymap.sections).toEqual(["Banking", "Cards and Loans", "Investing", "Subscriptions and Renewals", "For My Family", "Other"]);
    expect(TEMPLATES.moneymap.fields.find((f) => f.key === "kind")!.options).toContain("Subscription");
    expect(TEMPLATES.moneymap.pointersOnly).toBe(true);
    expect(TEMPLATES.moneymap.fields.some((f) => /password|pin\b|login/i.test(f.label))).toBe(false);
  });
  it("Expenses to Submit carries a reimbursement status, with the headings following it", () => {
    const status = TEMPLATES.expenses.fields.find((f) => f.key === "status")!;
    expect(status).toMatchObject({ label: "Status", type: "choice", options: ["To Submit", "Submitted", "Reimbursed"] });
    expect(TEMPLATES.expenses.sections).toEqual(status.options);
    expect(TEMPLATES.expenses.show).toContain("status");
    expect(TEMPLATES.expenses.suggested!.find((f) => f.key === "submittedOn")).toMatchObject({ label: "Submitted On", type: "date" });
    const page = newTemplatePage("expenses");
    expect(page.sections!.map((s) => s.label)).toEqual(["To Submit", "Submitted", "Reimbursed"]);
    expect(page.fields.find((f) => f.key === "status")!.options).toEqual(["To Submit", "Submitted", "Reimbursed"]);
  });
  it("Accomplishments and Milestones sits under Life and also Professional, as one template", () => {
    expect(TEMPLATES.accomplish.shelf).toBe("Life");
    expect(TEMPLATES.accomplish.alsoShelves).toEqual(["Professional"]);
    for (const k of TEMPLATE_KEYS) for (const s of TEMPLATES[k].alsoShelves ?? []) expect(s, k).not.toBe(TEMPLATES[k].shelf);
    // Forty in the picker: six note templates, four of slice one, and every catalog template that is not a preset.
    expect(6 + 4 + TEMPLATE_KEYS.filter((k) => !TEMPLATES[k].parent).length).toBe(40);
  });
});

describe("pointers only", () => {
  const page = newTemplatePage("moneymap");
  it("a password, a PIN and a long number are a way in", () => {
    expect(looksLikeSecret("password: hunter2")).toBe(true);
    expect(looksLikeSecret("my PIN is 4821")).toBe(true);
    expect(looksLikeSecret("4111 1111 1111 1111")).toBe(true);
    expect(looksLikeSecret("123-45-6789")).toBe(true);
    expect(looksLikeSecret("Chase checking, ending 4821")).toBe(false);
    expect(looksLikeSecret("In the blue folder in the file cabinet")).toBe(false);
    expect(looksLikeSecret("")).toBe(false);
  });
  it("names the field, lets a phone number through, and only polices a page of pointers", () => {
    expect(secretIn(page, { where: "login: dave / abc123" })).toEqual({ key: "where", label: "Where to Find It" });
    expect(secretIn(page, { contact: "555-123-4567" })).toBeNull();
    expect(secretIn(page, { contact: "phone pin: 1234" })).not.toBeNull();
    expect(secretIn(newTemplatePage("insurance"), { number: "123456789012" })).toBeNull();
  });
  it("refuses a field that asks for a way in", () => {
    expect(secretFieldName(page, "Password")).toBe(true);
    expect(secretFieldName(page, "Account Number")).toBe(true);
    expect(secretFieldName(page, "Where It Is")).toBe(false);
    expect(secretFieldName(newTemplatePage("insurance"), "Password")).toBe(false);
  });
  it("an import leaves a way in out and says so", () => {
    const rows = [["Name", "Where to Find It"], ["Savings", "password: swordfish"], ["Checking", "File cabinet"]];
    const plan = planImport(page, rows.slice(1), proposeMapping(page, rows[0]!));
    expect(plan.records.map((r) => r.v.where)).toEqual([undefined, "File cabinet"]);
    expect(plan.notes.join(" ")).toMatch(/1 Value Looked Like a Password or a Long Number and Was Not Kept/);
  });
});

describe("confirmation", () => {
  const base = (() => { let p = newTemplatePage("healthcard"); p = addRecord(p, { name: "Penicillin" }).page; p = addRecord(p, { name: "Dr. Ruiz" }).page; return p; })();
  it("is the person's tap alone, one row or all", () => {
    expect(base.records.every((r) => !r.confirmedOn)).toBe(true);
    const one = confirmRecord(base, base.records[0]!.id, "2026-10-14");
    expect(one.records[0]!.confirmedOn).toBe("2026-10-14");
    expect(one.records[1]!.confirmedOn).toBeUndefined();
    expect(confirmAll(base, "2026-10-14").records.every((r) => r.confirmedOn === "2026-10-14")).toBe(true);
  });
  it("is never, fresh or stale, and counts what is left", () => {
    const r = base.records[0]!;
    expect(confirmState(r, "2026-10-14")).toBe("never");
    expect(confirmState({ ...r, confirmedOn: "2026-10-01" }, "2026-10-14")).toBe("fresh");
    expect(confirmState({ ...r, confirmedOn: "2025-09-01" }, "2026-10-14")).toBe("stale");
    expect(unconfirmedCount(confirmRecord(base, r.id, "2026-10-14"), "2026-10-14")).toBe(1);
  });
});

describe("what is coming up", () => {
  it("counts days and finds the next birthday, Feb 29 included", () => {
    expect(daysBetween("2026-10-14", "2026-10-20")).toBe(6);
    expect(nextYearly("1990-10-20", "2026-10-14")).toBe("2026-10-20");
    expect(nextYearly("1990-10-10", "2026-10-14")).toBe("2027-10-10");
    expect(nextYearly("2000-02-29", "2026-10-14")).toBe("2027-02-28");
    expect(nextYearly("2000-02-29", "2027-10-14")).toBe("2028-02-29");
  });
  it("says it in the app's words", () => {
    const t = "2026-10-14";
    expect(dueFact("2026-10-12", t)).toEqual({ text: "2 Days Overdue", tone: "red" });
    expect(dueFact("2026-10-14", t)).toEqual({ text: "Due Today", tone: "warn" });
    expect(dueFact("2026-10-15", t)).toEqual({ text: "Due Tomorrow", tone: "warn" });
    expect(dueFact("2026-10-26", t)).toEqual({ text: "Due in 12 Days", tone: "plain" });
    expect(dueFact("2026-12-31", t)).toBeNull();
    expect(dueFact("1990-10-20", t, true)).toEqual({ text: "In 6 Days", tone: "warn" });
    expect(dueFact("1990-10-14", t, true)).toEqual({ text: "Today", tone: "warn" });
    expect(dueFact("", t)).toBeNull();
  });
});

describe("row order", () => {
  it("occasions come in order of the next time the day comes round; the undated go last", () => {
    let p = newTemplatePage("occasions");
    for (const [name, date] of [["Late", "1990-12-01"], ["Soon", "1985-10-16"], ["Gone By", "1970-09-01"], ["None", ""]] as const) p = addRecord(p, { name, date }).page;
    expect(orderedRecords(p, "2026-10-14").map((r) => r.v.name)).toEqual(["Soon", "Late", "Gone By", "None"]);
    expect(groupedRecords(p).flatMap((g) => g.records).length).toBe(4);
  });
  it("dated logs are newest first, and a page with no sort keeps the order it was made in", () => {
    let p = newTemplatePage("giving");
    for (const [to, date] of [["A", "2026-01-05"], ["B", "2026-03-09"], ["C", "2026-02-01"]] as const) p = addRecord(p, { to, date }).page;
    expect(orderedRecords(p).map((r) => r.v.to)).toEqual(["B", "C", "A"]);
    let q = newTemplatePage("handover");
    for (const topic of ["Z", "A"]) q = addRecord(q, { topic }).page;
    expect(orderedRecords(q).map((r) => r.v.topic)).toEqual(["Z", "A"]);
  });
});

describe("the debt plan", () => {
  const debts = [
    { id: "card", name: "Card", balance: 1000, apr: 24, min: 40 },
    { id: "loan", name: "Loan", balance: 500, apr: 6, min: 25 },
  ];
  it("avalanche pays the highest rate first, snowball the smallest balance", () => {
    expect(payoffPlan(debts, 100, "avalanche").order).toEqual(["card", "loan"]);
    expect(payoffPlan(debts, 100, "snowball").order).toEqual(["loan", "card"]);
  });
  it("avalanche never costs more interest than snowball, and extra shortens the road", () => {
    const a = payoffPlan(debts, 100, "avalanche");
    const s = payoffPlan(debts, 100, "snowball");
    expect(a.interest).toBeLessThanOrEqual(s.interest);
    expect(a.months).not.toBeNull();
    expect(payoffPlan(debts, 300, "avalanche").months!).toBeLessThan(a.months!);
    // Every debt clears, in some month, and the last one is the plan's length.
    expect(a.steps.length).toBe(2);
    expect(Math.max(...a.steps.map((x) => x.month))).toBe(a.months);
  });
  it("a debt that only grows is said to be uncleared, never an endless plan", () => {
    const plan = payoffPlan([{ id: "x", name: "X", balance: 10000, apr: 36, min: 50 }], 0, "avalanche");
    expect(plan.months).toBeNull();
  });
  it("is exact on a simple case", () => {
    // $1,200 at 0% with $100 a month is twelve months and no interest.
    const p = payoffPlan([{ id: "a", name: "A", balance: 1200, apr: 0, min: 100 }], 0, "avalanche");
    expect(p.months).toBe(12);
    expect(p.interest).toBe(0);
    expect(monthsWords(14)).toBe("1 Year 2 Months");
    expect(monthsWords(24)).toBe("2 Years");
    expect(monthsWords(1)).toBe("1 Month");
  });
  it("a settled debt has no plan", () => {
    const p = payoffPlan([{ id: "a", name: "A", balance: 0, apr: 5, min: 10 }], 0, "avalanche");
    expect(p.months).toBe(0);
    expect(p.order).toEqual([]);
  });
  it("a linked row takes Money's balance and name, an unlinked one its own", () => {
    let page = newTemplatePage("debt");
    page = addRecord(page, { name: "Old Name", apr: "19.9", min: "35", balance: "800" }).page;
    page = addRecord(page, { name: "Car Loan", apr: "5", min: "300", balance: "9000" }).page;
    page = { ...page, records: page.records.map((r, i) => (i === 0 ? { ...r, link: "acct1" } : r)) };
    const d = debtsOf(page, (id) => (id === "acct1" ? { balance: 2450.5, name: "Visa" } : null));
    expect(d.map((x) => [x.name, x.balance, x.apr, x.min])).toEqual([["Visa", 2450.5, 19.9, 35], ["Car Loan", 9000, 5, 300]]);
    // A link to an account that is gone falls back to the row's own balance.
    expect(debtsOf(page, () => null)[0]!.balance).toBe(800);
  });
});

describe("the business ledger", () => {
  const tx = (id: string, over: Partial<TrackerTx["data"]> = {}): TrackerTx => ({ id, data: { date: "2026-03-04", month: "2026-03", merchant: "Staples", name: "STAPLES 123", amountCents: 4599, category: "Business", account: "Visa", ...over } });
  const receipt = (id: string, over: Partial<Receipt["data"]> = {}): Receipt => ({ id, data: { vendor: "Kinkos", amountCents: 1200, currency: "USD", transactionDate: "2026-04-01", category: "Business", source: "manual", fingerprint: id, history: [], ...over } });
  it("reads the category and year, newest first, and leaves out money coming in", () => {
    const rows = businessRows([tx("a"), tx("b", { date: "2026-05-01", merchant: "Zoom", amountCents: 1500 }), tx("c", { category: "Groceries" }), tx("d", { amountCents: -5000 }), tx("e", { date: "2025-12-31" })], [receipt("r1")], "business", 2026);
    expect(rows.map((r) => [r.vendor, r.cents, r.from])).toEqual([["Zoom", 1500, "Spending"], ["Kinkos", 1200, "Receipt"], ["Staples", 4599, "Spending"]]);
  });
  it("a receipt a payment is matched to is that payment, drawn once", () => {
    const rows = businessRows([tx("a", { matchedReceiptId: "r1" })], [receipt("r1"), receipt("r2", { linkedTransactionId: "a" })], "Business", null);
    expect(rows.length).toBe(1);
    expect(rows[0]!.from).toBe("Spending");
  });
  it("its filter is the page's own: Business, and every year until one is set", () => {
    expect(ledgerFilter(newTemplatePage("bizledger"))).toEqual({ category: "Business", year: null });
    expect(ledgerFilter({ ...newTemplatePage("bizledger"), meta: { category: " Consulting ", year: "2026" } })).toEqual({ category: "Consulting", year: 2026 });
    expect(ledgerFilter({ ...newTemplatePage("bizledger"), meta: { category: "", year: "20" } })).toEqual({ category: "Business", year: null });
  });
});

describe("what the app suggests", () => {
  it("offers achieved goals and finished projects the page does not list, newest first", () => {
    let page = newTemplatePage("accomplish");
    page = addRecord(page, { title: "Run a Half Marathon" }).page;
    const goals = [
      { id: "g1", data: { title: "Run a Half Marathon", state: "achieved", achievedOn: "2026-05-01" } },
      { id: "g2", data: { title: "Learn Spanish", state: "achieved", achievedOn: "2026-08-10" } },
      { id: "g3", data: { title: "Not Yet", state: "on_track" } },
    ] as never;
    const projects = [{ id: "p1", data: { title: "Kitchen Remodel", status: "done", closedOn: "2026-09-20" } }, { id: "p2", data: { title: "Open", status: "active" } }] as never;
    const s = accomplishmentSuggestions(page, goals, projects);
    expect(s.map((x) => x.values.title)).toEqual(["Kitchen Remodel", "Learn Spanish"]);
    expect(s[0]!.values.date).toBe("2026-09-20");
  });
  it("offers birthdays from People, once", () => {
    let page = newTemplatePage("occasions");
    page = addRecord(page, { name: "Mom", occasion: "Birthday", date: "2026-03-04" }).page;
    const people = [
      { id: "1", data: { name: "Mom", birthday: "1960-03-04" } },
      { id: "2", data: { name: "Sam", birthday: "1990-11-09" } },
      { id: "3", data: { name: "Jo", birthday: "March 4" } },
      { id: "4", data: { name: "No Date" } },
    ] as never;
    const s = birthdaySuggestions(page, people, 2026);
    expect(s.map((x) => [x.values.name, x.values.date])).toEqual([["Jo", "2026-03-04"], ["Sam", "2026-11-09"]]);
  });
});
