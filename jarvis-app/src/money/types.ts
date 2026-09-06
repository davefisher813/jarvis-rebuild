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
export function formatMoney(n: number): string {
  const cents = Number.isFinite(n) && Math.round(n * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
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
