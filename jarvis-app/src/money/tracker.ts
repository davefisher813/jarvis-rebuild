// THE TRACKER'S OWN ARITHMETIC (PASSOFF 2026-09-19).
//
// The Money page answers "what is actually mine right now". The Tracker
// answers the other half: where it went. Accounts with real balances, every
// transaction in a month, what each category and each merchant took, budgets
// per month and the subscriptions that bill whether or not anyone looks.
//
// AMOUNTS ARE INTEGER CENTS HERE, and only here. The rest of the Money page
// stores dollars (types.ts, AccountData.balance) because a self-entered
// balance is a round number a person typed. A ledger is not: $23.19 and
// $50.09 have to add up to the cent across 31 rows, and float dollars do not
// survive that. The two never mix -- a Tracker record is never read as an
// account balance and vice versa -- so there is no boundary to get wrong.
//
// SIGN: positive is money OUT, negative is money IN. That reads backwards
// against a bank statement and is right for this screen, whose whole job is
// spending: the biggest number is the one that cost the most.

export const ENTITY_MONEY_ACCOUNT = "money_account";
export const ENTITY_MONEY_TX = "money_tx";
export const ENTITY_MONEY_BUDGET = "money_budget";
export const ENTITY_MONEY_SUB = "money_sub";

export type TrackerAccountType = "checking" | "savings" | "credit card";
export type SubFrequency = "Monthly" | "Yearly" | "Weekly";
export type SubStatus = "active" | "cancelled";

export interface TrackerAccountData {
  name: string;
  type: TrackerAccountType;
  currentBalanceCents: number;
  /** On a card this is the credit still available, not the balance. */
  availableBalanceCents: number;
}
export interface TrackerTxData {
  /** ISO day. */
  date: string;
  /** YYYY-MM, always derived from `date` so the two cannot disagree. */
  month: string;
  merchant: string;
  /** The line as the bank wrote it; falls back to the merchant. */
  name: string;
  amountCents: number;
  category: string;
  /** The account's NAME, as the statement carries it. */
  account: string;
}
export interface TrackerBudgetData {
  month: string;
  expectedIncomeCents: number;
  savingsTargetCents: number;
  /** Category name to its limit in cents. */
  allocations: Record<string, number>;
}
export interface TrackerSubData {
  merchantName: string;
  amountCents: number;
  frequency: SubFrequency;
  status: SubStatus;
}

export interface TrackerAccount { id: string; data: TrackerAccountData }
export interface TrackerTx { id: string; data: TrackerTxData }
export interface TrackerBudget { id: string; data: TrackerBudgetData }
export interface TrackerSub { id: string; data: TrackerSubData }

export interface TrackerData {
  accounts: TrackerAccount[];
  txs: TrackerTx[];
  budgets: TrackerBudget[];
  subs: TrackerSub[];
}

export const EMPTY_TRACKER: TrackerData = { accounts: [], txs: [], budgets: [], subs: [] };

// ---------------------------------------------------------------------------
// Money in and out of words
// ---------------------------------------------------------------------------

/**
 * A ledger amount, always to the cent.
 *
 * Deliberately NOT types.ts's formatMoney, which drops ".00" from a whole
 * number: that rule is right for one self-entered balance and wrong for a
 * column of them, where "$105" beside "$126.69" stops lining up and stops
 * reading as the same kind of number.
 */
export function fmtCents(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  const sign = n < 0 ? "-" : "";
  return sign + "$" + (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** What a typed field means in cents. Junk reads as nothing, never as NaN. */
export function dollarsToCents(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-14" to "Sep 14". */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return MONTHS[m - 1] + " " + d;
}

/** "2026-09" to "September 2026", the month's own full name. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const full = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  return full + " " + y;
}

/** The YYYY-MM a day belongs to. One rule, so a row cannot be filed twice. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

export function shiftMonth(ym: string, by: number): string {
  const [y0, m0] = ym.split("-").map(Number);
  if (!y0 || !m0) return ym;
  // Date does the carry, so December to January moves the year with it.
  const d = new Date(y0, m0 - 1 + by, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function thisMonth(now = new Date()): string {
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// What the month did
// ---------------------------------------------------------------------------

const out = (t: TrackerTx) => t.data.amountCents > 0;

export function inMonth(txs: TrackerTx[], month: string): TrackerTx[] {
  return txs.filter((t) => t.data.month === month)
    .sort((a, b) => b.data.date.localeCompare(a.data.date) || a.data.merchant.localeCompare(b.data.merchant));
}

export function spentCents(txs: TrackerTx[]): number {
  return txs.filter(out).reduce((s, t) => s + t.data.amountCents, 0);
}

export function incomeCents(txs: TrackerTx[]): number {
  return Math.abs(txs.filter((t) => t.data.amountCents < 0).reduce((s, t) => s + t.data.amountCents, 0));
}

/** Spending per category, biggest first. Income never appears: it is not spend. */
export function byCategory(txs: TrackerTx[]): [string, number][] {
  const m = new Map<string, number>();
  for (const t of txs) if (out(t)) m.set(t.data.category, (m.get(t.data.category) ?? 0) + t.data.amountCents);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function topMerchants(txs: TrackerTx[], limit = 8): [string, number][] {
  const m = new Map<string, number>();
  for (const t of txs) if (out(t)) m.set(t.data.merchant, (m.get(t.data.merchant) ?? 0) + t.data.amountCents);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

/** What a subscription costs every month, whatever cycle it bills on. */
export function monthlyCents(s: TrackerSubData): number {
  if (s.frequency === "Yearly") return Math.round(s.amountCents / 12);
  if (s.frequency === "Weekly") return Math.round((s.amountCents * 52) / 12);
  return s.amountCents;
}

export function monthlySubTotal(subs: TrackerSub[]): number {
  return subs.filter((s) => s.data.status === "active").reduce((sum, s) => sum + monthlyCents(s.data), 0);
}

// ---------------------------------------------------------------------------
// The colours
// ---------------------------------------------------------------------------

// VIBRANT, SATURATED, AND HIS CHOICE (PASSOFF: "owner's explicit
// preference"). These are spending categories a bank named, not the app's
// own Areas, so they do not draw from the category colour slots: a bar chart
// needs neighbouring bars to be told apart at a glance, which is a different
// job from tinting a row by which part of a life it belongs to.
//
// Every value is a hue, never a verdict. Overdraft is red because a fee is
// the one category that IS bad news, and that is the only red here.
const CATEGORY_COLORS: Record<string, string> = {
  "Restaurants": "#ff4d5e",
  "Fast Food": "#ff8a3d",
  "Supermarkets and Groceries": "#35c759",
  "Food and Beverage Store": "#a06bff",
  "Golf": "#30c9c9",
  "Sporting Goods": "#4da3ff",
  "Digital Purchase": "#ff4dd2",
  "Subscription": "#ffd60a",
  "Service": "#8e8e93",
  "Charities and Non-Profits": "#ff9f0a",
  "Overdraft": "#ff3b30",
  "Income": "#34e07a",
  "Other": "#6e6e73",
};
const FALLBACK = ["#ff4d5e", "#ff8a3d", "#ffd60a", "#35c759", "#30c9c9", "#4da3ff", "#a06bff", "#ff4dd2"];

/** A category's colour. Named ones keep theirs; anything new gets a stable
 *  one from its own letters, so it does not change between renders. */
export function categoryColor(name: string, idx = 0): string {
  const known = CATEGORY_COLORS[name];
  if (known) return known;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return FALLBACK[(h + idx) % FALLBACK.length]!;
}

/** Every category the ledger has seen, for a picker that offers real ones. */
export function knownCategories(txs: TrackerTx[]): string[] {
  const s = new Set<string>(txs.map((t) => t.data.category));
  s.add("Other");
  return [...s].sort();
}
