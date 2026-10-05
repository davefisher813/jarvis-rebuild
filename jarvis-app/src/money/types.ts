export const ENTITY_ACCOUNT = "account";
export type AccountKind = "cash" | "savings" | "investment" | "credit" | "other";

// asOf: when the balance was last entered. Balances are self-reported and the
// page must say so with a date (Money v1 law) rather than posing as live data.
export interface AccountData { name: string; balance: number; kind: AccountKind; order?: number; asOf?: string; }
export interface Account { id: string; data: AccountData; }

export const ACCOUNT_META: Record<AccountKind, { label: string; slot: string }> = {
  cash: { label: "Cash", slot: "green" },
  savings: { label: "Savings", slot: "sky" },
  investment: { label: "Investment", slot: "blue" },
  credit: { label: "Credit", slot: "red" },
  other: { label: "Other", slot: "graphite" },
};
/** True when an account's name already contains its kind's word, so the kind line would only restate the title. */
export const kindRestated = (name: string, kind: string): boolean =>
  name.toLowerCase().split(/[^a-z0-9]+/).includes(kind.toLowerCase());

export const ACCOUNT_KINDS: AccountKind[] = ["cash", "savings", "investment", "credit", "other"];

// HMN-F-25 (2026-09-05), option B. Whole dollars were a design choice, and
// the bill sheet's own amount field accepts cents (BillSheet.tsx:63,
// inputMode="decimal"), so a $49.99 bill read "$50" and a $12.50 one read
// "$13": the rows on screen could sum to a different number than the total
// under them, which is computed on the exact values. Cents show when the
// number actually carries them, and only then, so nothing gains a ".00" it
// never had.
//
// The currency stays USD until there is a real place to say otherwise: a
// profile currency is the App Store follow-up, and guessing one from the
// device locale would relabel dollars as euros without moving the amount.
export function formatMoney(n: number, opts: { cents?: boolean } = {}): string {
  const cents = opts.cents || (Number.isFinite(n) && Math.round(n * 100) % 100 !== 0);
  const out = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
  // A NEGATIVE IS A TRUE MINUS (2026-10-05, the round-2 review: "-$1,240.30" drew a hyphen). U+2212 is as wide as the plus
  // sign and sits at the digits' height, so a column of amounts lines up; the hyphen-minus is a dash and reads as one.
  return out.replace(/^-/, MINUS);
}

/** The minus sign every amount in the app wears (U+2212), never a hyphen. */
export const MINUS = "\u2212";

/** ONE LIST, ONE SHAPE (2026-10-05, the round-2 review: "$18,230" under "$32,540.75" and "-$1,240.30" does not line up).
 *  True when any amount in a list carries cents, so the whole list is drawn with two decimals, or with none when none
 *  does. A list that mixed the two was a ragged column. */
export function listHasCents(values: number[]): boolean {
  return values.some((n) => Number.isFinite(n) && Math.round(n * 100) % 100 !== 0);
}
// HMN-F-13 (2026-09-05), option A. A credit account is money OWED. The sheet
// asked for a "Balance" with inputMode="numeric", and the iPhone keypad that
// mode brings up has no minus sign at all, so $2,000 owed went in as 2,000
// and Total balance went UP by the size of the debt. The kind now carries the
// sign: the field asks for what is owed, as a plain positive number, and the
// total subtracts it.
//
// The sign is not information on this kind. A record written by an older
// build with -2000 (typable with an external keyboard) means the same $2,000
// owed, so both read the same way and no stored account needs migrating.
export const isLiability = (kind: AccountKind): boolean => kind === "credit";

/** What this account contributes to the total: a debt, always negative. */
export function signedBalance(d: AccountData): number {
  if (!Number.isFinite(d.balance)) return 0;
  return isLiability(d.kind) ? -Math.abs(d.balance) : d.balance;
}

export function totalBalance(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + signedBalance(a.data), 0);
}
