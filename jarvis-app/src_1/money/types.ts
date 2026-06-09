export const ENTITY_ACCOUNT = "account";
export type AccountKind = "cash" | "savings" | "investment" | "credit" | "other";

export interface AccountData { name: string; balance: number; kind: AccountKind; order?: number; }
export interface Account { id: string; data: AccountData; }

export const ACCOUNT_META: Record<AccountKind, { label: string; slot: string }> = {
  cash: { label: "Cash", slot: "green" },
  savings: { label: "Savings", slot: "sky" },
  investment: { label: "Investment", slot: "blue" },
  credit: { label: "Credit", slot: "red" },
  other: { label: "Other", slot: "graphite" },
};
export const ACCOUNT_KINDS: AccountKind[] = ["cash", "savings", "investment", "credit", "other"];

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
export function totalBalance(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + (Number.isFinite(a.data.balance) ? a.data.balance : 0), 0);
}
